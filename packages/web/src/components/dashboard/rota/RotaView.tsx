import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addRotaDays,
  rotaClock,
  rotaLocalDate,
  rotaMondayOf,
  rotaWeekDates,
  type CalendarResponse,
  type RotaShift,
  type RotaWeek,
  type StaffRecord,
} from "@omnitwin/types";
import { getCalendar } from "../../../api/diary.js";
import { getRotaWeek } from "../../../api/rota.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useMediaQuery } from "../../../hooks/use-media-query.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { PublishControl } from "./PublishControl.js";
import { RotaDayList, RotaWeekTable } from "./RotaWeekTable.js";
import { ShiftEditor, type PanelMessage } from "./ShiftEditor.js";
import { StaffDrawer } from "./StaffDrawer.js";
import { functionsByDay, prefillShift, rotaWeekTitle, weekSummary, type ShiftDraft } from "./rota-format.js";
import "./Rota.css";

// ---------------------------------------------------------------------------
// The Rota (T-637 slice B). It reads like the Diary: a week, people down the
// side and days across, the week's Confirmed functions along the top. The
// venue's administrators plan it in draft and publish it, which tells the
// people on it; the venue floor reads the published week; anyone else on it
// sees their own shifts. Detail opens beside the week, never in its place.
// ---------------------------------------------------------------------------

type Load =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly key: string; readonly week: RotaWeek; readonly refreshing: boolean; readonly failedAt: number | null };

type CalendarLoad =
  | { readonly status: "idle" }
  | { readonly status: "ready"; readonly range: string; readonly calendar: CalendarResponse }
  | { readonly status: "error"; readonly range: string };

type Panel =
  | { readonly kind: "new"; readonly draft: ShiftDraft; readonly key: string }
  | { readonly kind: "shift"; readonly shiftId: string; readonly fallback: RotaShift | null }
  | { readonly kind: "staff"; readonly personId: string | null; readonly key: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Puts a saved row in place of its older copy, or adds it. */
function upsert<T extends { readonly id: string }>(rows: readonly T[], row: T): T[] {
  return rows.some((candidate) => candidate.id === row.id)
    ? rows.map((candidate) => candidate.id === row.id ? row : candidate)
    : [...rows, row];
}

export function RotaView(): ReactElement {
  const venueId = useAuthStore((state) => state.user?.venueId ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const weekParam = searchParams.get("week");
  const requestedWeek = weekParam !== null && DATE.test(weekParam) ? rotaMondayOf(weekParam) : null;
  const [reloads, setReloads] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [calendarLoad, setCalendarLoad] = useState<CalendarLoad>({ status: "idle" });
  const [panel, setPanel] = useState<Panel | null>(null);
  const [panelMessage, setPanelMessage] = useState<PanelMessage | null>(null);
  const [pageMessage, setPageMessage] = useState<PanelMessage | null>(null);
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const phone = useMediaQuery("(max-width: 760px)");
  const turnTaking = useMediaQuery("(max-width: 1179px)");
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const loadKey = `${venueId ?? ""}|${requestedWeek ?? "this week"}`;

  // Another week starts from nothing; the same week, read again after a
  // change, stays on screen while it refreshes.
  useEffect(() => {
    if (venueId === null) return;
    const controller = new AbortController();
    setLoad((previous) => previous.status === "ready" && previous.key === loadKey ? { ...previous, refreshing: true } : { status: "loading" });
    getRotaWeek(venueId, requestedWeek, controller.signal)
      .then((week) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", key: loadKey, week, refreshing: false, failedAt: null });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoad((previous) => previous.status === "ready" && previous.key === loadKey
          ? { ...previous, refreshing: false, failedAt: Date.now() } : { status: "error" });
      });
    return () => { controller.abort(); };
  }, [venueId, requestedWeek, loadKey, reloads]);

  const week = load.status === "ready" ? load.week : null;
  const range = week === null ? "" : `${week.from}|${week.to}`;
  const readsDiary = week !== null && week.access !== "own";

  useEffect(() => {
    if (venueId === null || week === null || !readsDiary) return;
    const controller = new AbortController();
    getCalendar(venueId, week.from, week.to, controller.signal)
      .then((calendar) => { if (!controller.signal.aborted) setCalendarLoad({ status: "ready", range, calendar }); })
      .catch(() => { if (!controller.signal.aborted) setCalendarLoad({ status: "error", range }); });
    return () => { controller.abort(); };
    // The calendar follows the week's range, and re-reads with the rota.
  }, [venueId, range, readsDiary, reloads]);

  const functions = useMemo(
    () => week !== null && calendarLoad.status === "ready" && calendarLoad.range === range ? functionsByDay(calendarLoad.calendar, week.timeZone) : null,
    [week, calendarLoad, range],
  );

  const refresh = (): void => { setReloads((count) => count + 1); };

  // A save shows at once; the week is then read again for everything it touched.
  const savedShift = (shift: RotaShift): void => {
    setLoad((previous) => previous.status === "ready" ? { ...previous, week: { ...previous.week, shifts: upsert(previous.week.shifts, shift) } } : previous);
  };
  const savedRecord = (record: StaffRecord): void => {
    setLoad((previous) => previous.status === "ready" ? { ...previous, week: { ...previous.week, records: upsert(previous.week.records, record) } } : previous);
  };

  const goToWeek = (weekStart: string | null): void => {
    setPageMessage(null);
    const next = new URLSearchParams(searchParams);
    if (weekStart === null) next.delete("week");
    else next.set("week", weekStart);
    setSearchParams(next, { replace: true });
  };

  const closePanel = (): void => {
    setPanel(null);
    setPanelMessage(null);
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected === true) target.focus();
    else titleRef.current?.focus();
  };

  const openPanel = (next: Panel, trigger: HTMLElement | null): void => {
    returnFocus.current = trigger;
    setPanelMessage(null);
    setPanel(next);
  };

  if (venueId === null) {
    return (
      <div className="rota" data-register="ivory">
        <div className="rota__sheet"><h1 className="rota__title">Rota</h1>
          <p className="rota__lede">Your account has no venue yet, so there is no rota to show. Ask an administrator to link one.</p></div>
      </div>
    );
  }

  if (load.status !== "ready") {
    return (
      <div className="rota" data-register="ivory">
        <div className="rota__sheet">
          <h1 className="rota__title">Rota</h1>
          {load.status === "error" ? (
            <div className="rota-state" role="alert">
              <p>The rota could not be loaded. Nothing has changed.</p>
              <button type="button" className="rota-button" onClick={refresh}>Try again</button>
            </div>
          ) : <ActivityStatus variant="panel" className="rota-state">Loading the rota…</ActivityStatus>}
        </div>
      </div>
    );
  }

  const shown = load.week;
  const manage = shown.access === "manage";
  const tz = shown.timeZone;
  const today = rotaLocalDate(Date.now(), tz);
  const dates = rotaWeekDates(shown.weekStart);
  const day = chosenDay !== null && dates.includes(chosenDay) ? chosenDay : dates.includes(today) ? today : shown.weekStart;
  const summary = weekSummary(shown);
  const thisWeek = rotaMondayOf(today) === shown.weekStart;
  const records = new Map(shown.records.map((record) => [record.id, record]));

  const panelShift = panel?.kind === "shift" ? shown.shifts.find((shift) => shift.id === panel.shiftId) ?? panel.fallback : null;
  const selectedShiftId = panel?.kind === "shift" ? panel.shiftId : null;

  const actions = {
    onOpenShift: (shift: RotaShift, trigger: HTMLElement): void => { openPanel({ kind: "shift", shiftId: shift.id, fallback: shift }, trigger); },
    onAdd: manage ? (personId: string | null, date: string, trigger: HTMLElement): void => {
      const record = personId === null ? null : records.get(personId) ?? null;
      const draft = prefillShift({ record, date, functions: functions?.get(date)?.confirmed ?? [], timeZone: tz });
      openPanel({ kind: "new", draft, key: `${personId ?? "unfilled"}|${date}|${String(Date.now())}` }, trigger);
    } : null,
    onOpenPerson: manage ? (personId: string, trigger: HTMLElement): void => {
      openPanel({ kind: "staff", personId, key: `${personId}|${String(Date.now())}` }, trigger);
    } : null,
  };

  const lede = ((): ReactElement => {
    if (shown.access === "own") {
      if (shown.people.length === 0) return <>You are not on this venue&apos;s rota.</>;
      if (summary.shifts === 0) return <>You have no shifts this week.</>;
      return <>You have <strong>{summary.shifts} {summary.shifts === 1 ? "shift" : "shifts"}</strong> this week.</>;
    }
    if (summary.shifts === 0) return <>No shifts this week yet.{manage ? " Choose a day beside someone's name to add one." : ""}</>;
    return (
      <>
        <strong>{summary.shifts} {summary.shifts === 1 ? "shift" : "shifts"}</strong> for{" "}
        <strong>{summary.people} {summary.people === 1 ? "person" : "people"}</strong>.{" "}
        {summary.unfilled > 0
          ? <><strong data-tone="attention">{summary.unfilled}</strong> still {summary.unfilled === 1 ? "needs" : "need"} someone.</>
          : <span data-tone="settled">All shifts filled.</span>}
      </>
    );
  })();

  const panelOpen = panel !== null;
  const hideWeek = panelOpen && turnTaking;

  return (
    <div className={`rota${panelOpen && !turnTaking ? " rota--with-panel" : ""}`} data-register="ivory">
      <div className="rota__sheet" hidden={hideWeek}>
        <header className="rota__head">
          <div className="rota__heading">
            <p className="rota__eyebrow">{rotaWeekTitle(shown.weekStart)}</p>
            <h1 className="rota__title" ref={titleRef} tabIndex={-1}>Rota</h1>
            <p className="rota__lede">{lede}</p>
            <div className="rota__bar">
              <nav className="rota__weeks" aria-label="Weeks">
                <button type="button" className="rota-button" aria-label="Earlier week"
                  onClick={() => { goToWeek(addRotaDays(shown.weekStart, -7)); }}>
                  <ChevronLeft aria-hidden="true" size={18} /> <span className="rota__weeks-word">Earlier</span>
                </button>
                <button type="button" className="rota-button" disabled={thisWeek} onClick={() => { goToWeek(null); }}>This week</button>
                <button type="button" className="rota-button" aria-label="Later week"
                  onClick={() => { goToWeek(addRotaDays(shown.weekStart, 7)); }}>
                  <span className="rota__weeks-word">Later</span> <ChevronRight aria-hidden="true" size={18} />
                </button>
              </nav>
              {load.refreshing && <ActivityStatus className="rota__refreshing">Loading the week…</ActivityStatus>}
              {manage && (
                <button type="button" className="rota-button rota__staff" aria-expanded={panel?.kind === "staff"}
                  onClick={(event) => { openPanel({ kind: "staff", personId: null, key: String(Date.now()) }, event.currentTarget); }}>
                  Staff
                </button>
              )}
            </div>
          </div>
          {manage && (
            <PublishControl venueId={venueId} week={shown} onDone={(message) => { setPageMessage(message); refresh(); }} />
          )}
        </header>

        {pageMessage !== null && (
          <p className="rota-notice" data-tone={pageMessage.tone} role={pageMessage.tone === "alert" ? "alert" : "status"}>{pageMessage.text}</p>
        )}
        {load.failedAt !== null && (
          <div className="rota-notice" data-tone="alert" role="alert">
            <span>Could not refresh at {rotaClock(load.failedAt, tz)}. Showing the rota as last loaded.</span>
            <button type="button" className="rota-link" onClick={refresh}>Try again</button>
          </div>
        )}

        {shown.access !== "own" && (
          <dl className="rota__plane ws-plane" aria-label="This week in numbers">
            <div><dt>Shifts</dt><dd>{summary.shifts}</dd></div>
            <div data-tone={summary.unfilled > 0 ? "attention" : undefined}><dt>Unfilled</dt><dd>{summary.unfilled}</dd></div>
            {manage && <div data-tone={summary.withWarnings > 0 ? "attention" : undefined}><dt>With warnings</dt><dd>{summary.withWarnings}</dd></div>}
            {manage && <div><dt>In draft</dt><dd>{summary.drafts}</dd></div>}
            <div><dt>Hours</dt><dd>{summary.hours}</dd></div>
          </dl>
        )}

        {manage && summary.drafts > 0 && (
          <p className="rota-legend">Shifts with a dashed edge are drafts: nobody hears of them until the week is published.</p>
        )}

        {readsDiary && calendarLoad.status === "error" && calendarLoad.range === range && (
          <p className="rota-quiet-note">The Diary&apos;s functions could not be loaded, so the week shows the rota alone.</p>
        )}

        {manage && shown.people.length === 0 && (
          <div className="rota-state">
            <p>Nobody is on the rota yet. Add the people you roster; they need no login.</p>
            <button type="button" className="rota-button rota-button--primary"
              onClick={(event) => { openPanel({ kind: "staff", personId: "new", key: String(Date.now()) }, event.currentTarget); }}>Add a person</button>
          </div>
        )}

        {phone
          ? <RotaDayList week={shown} functions={functions} today={today} selectedShiftId={selectedShiftId} {...actions} day={day} onDayChange={setChosenDay} />
          : <RotaWeekTable week={shown} functions={functions} today={today} selectedShiftId={selectedShiftId} {...actions} />}
      </div>

      {panel !== null && (
        <aside className="rota__side" aria-label={panel.kind === "staff" ? "Staff" : "Shift"}>
          {panel.kind === "staff" && (
            <StaffDrawer key={panel.key} venueId={venueId} week={shown} today={today} openPersonId={panel.personId}
              onChanged={(saved) => { if (saved !== null) savedRecord(saved); refresh(); }} onClose={closePanel} />
          )}
          {panel.kind === "new" && (
            <ShiftEditor key={panel.key} venueId={venueId} week={shown} functions={functions} shift={null} newDraft={panel.draft}
              canManage={manage} message={panelMessage}
              onSaved={(shift, message) => {
                savedShift(shift);
                setPanel({ kind: "shift", shiftId: shift.id, fallback: shift });
                setPanelMessage(message);
                refresh();
              }}
              onRemoved={(words) => { setPageMessage({ tone: "settled", text: words }); closePanel(); refresh(); }}
              onClose={closePanel} />
          )}
          {panel.kind === "shift" && panelShift !== null && (
            <ShiftEditor key={`${panelShift.id}:${String(panelShift.revision)}`} venueId={venueId} week={shown} functions={functions}
              shift={panelShift} newDraft={null} canManage={manage} message={panelMessage}
              onSaved={(shift, message) => {
                savedShift(shift);
                setPanel({ kind: "shift", shiftId: shift.id, fallback: shift });
                setPanelMessage(message);
                refresh();
              }}
              onRemoved={(words) => { setPageMessage({ tone: "settled", text: words }); closePanel(); refresh(); }}
              onClose={closePanel} />
          )}
        </aside>
      )}
    </div>
  );
}
