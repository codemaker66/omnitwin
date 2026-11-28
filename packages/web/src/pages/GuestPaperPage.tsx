import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { KitGate } from "../components/guest-list/KitGate.js";
import {
  calendarDay,
  counted,
  NOT_KEPT,
  NOT_OPENED,
  NOT_YET_PRINTED,
  noticeWords,
  weekday,
} from "../components/guest-list/words.js";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import { KIT_PARAM } from "../lib/guest-list/kit-switch.js";
import { printedFromOlderCopy, type GuestList } from "../lib/guest-list/model.js";
import { byTable, covers, markPrinted, placeCards, tablePlanAZ, type Sheet } from "../lib/guest-list/paper.js";
import { guestListStore, type GuestListStore } from "../lib/guest-list/store.js";
import { useGuestListStore } from "../stores/guest-list-store.js";
import "./GuestPaperPage.css";

// ---------------------------------------------------------------------------
// The planner's paper (the planner's kit), at /plan/:code/guests/paper behind
// the kit's switch: the table plan for the door, guests by table, place cards
// and covers for the caterer, one sheet at a time (`?sheet=`). Everything is
// drawn from the list kept in this browser; this page asks nothing of the
// server and does not read the room. Above the paper, on screen only, are the
// tools: which sheet, its count, its version, the four sheets, Print and the
// way back.
// ---------------------------------------------------------------------------

const PAGE_TITLE = "Table plan and paper";
const SHEET_PARAM = "sheet";
const CARDS_A_PAGE = 10;

const SHEETS: readonly { readonly sheet: Sheet; readonly label: string }[] = [
  { sheet: "table-plan", label: "Table plan" },
  { sheet: "by-table", label: "Guests by table" },
  { sheet: "place-cards", label: "Place cards" },
  { sheet: "covers", label: "Covers for the caterer" },
];

/**
 * Ten 90 by 55 mm cards take 275 mm of A4's 297, more than the 14 mm margins
 * leave, so while the place cards are shown their pages get margins of their
 * own. One sheet shows at a time, so this needs no named page.
 */
const CARDS_PAGE_STYLE = "@media print{@page{size:A4;margin:10mm 14mm}}";

export function GuestPaperPage({ store }: { readonly store?: GuestListStore }): ReactElement {
  return (
    <KitGate title={PAGE_TITLE}>
      {(planId) => <GuestPaper key={planId} planId={planId} store={store ?? guestListStore()} />}
    </KitGate>
  );
}

export default GuestPaperPage;

// ---------------------------------------------------------------------------
// Addresses and words
// ---------------------------------------------------------------------------

/** An unknown or missing `?sheet=` shows the table plan. */
function sheetFrom(search: string): Sheet {
  const asked = new URLSearchParams(search).get(SHEET_PARAM);
  return SHEETS.find((entry) => entry.sheet === asked)?.sheet ?? "table-plan";
}

/** This page with only the sheet changed; it always carries the switch, so a device that forgot it still answers. */
function sheetAddress(planId: string, search: string, sheet: Sheet): string {
  const params = new URLSearchParams(search);
  params.set(KIT_PARAM, "on");
  params.set(SHEET_PARAM, sheet);
  return `/plan/${planId}/guests/paper?${params.toString()}`;
}

function listAddress(planId: string): string {
  return `/plan/${planId}/guests?${KIT_PARAM}=on`;
}

/** "Saturday 12 June 2027", or null when the list has no date. */
function eventDay(list: GuestList): string | null {
  return list.eventDate === null ? null : `${weekday(list.eventDate)} ${calendarDay(list.eventDate)}`;
}

/**
 * "Version 6 · printed 13 November 2026", or "Not yet printed". The day of a
 * print is the day on this device's own clock, as the list page tells it; the
 * formatter is made each time so it follows the device's zone as it is now.
 */
function versionLine(list: GuestList): string {
  if (list.paperVersion === 0 || list.printedAt === null) return NOT_YET_PRINTED;
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `Version ${String(list.paperVersion)} · printed ${day.format(Date.parse(list.printedAt))}`;
}

function countWords(sheet: Sheet, seated: number): string {
  switch (sheet) {
    case "table-plan":
    case "by-table":
      return counted(seated, "name", "names");
    case "place-cards":
      return counted(seated, "card", "cards");
    case "covers":
      return counted(seated, "cover", "covers");
  }
}

function inPages<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const pages: T[][] = [];
  for (let at = 0; at < items.length; at += size) pages.push(items.slice(at, at + size));
  return pages;
}

// ---------------------------------------------------------------------------
// Opening the list from this device
// ---------------------------------------------------------------------------

/**
 * Reads the device every time the page mounts: removes lists past their day,
 * then opens this plan's list, or, when the page state already holds it (the
 * planner came here from the list page, or went elsewhere in the app and came
 * back), takes up what another tab did meanwhile. Answers false until that
 * read has returned: the page stays in its opening state till then, so no
 * print can go before a list the page has not yet seen.
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
      // The sweep goes first, so a list past its removal day is not printed. That holds when this
      // sweep gets the lock: when another tab holds the lock past the bound, the sweep removes
      // nothing this time, and the list is opened, and can be printed.
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
      // In one step with its effects, as when the page state itself changes: the paper is never on the page half set up.
      if (!gone()) flushSync(() => { setRead(true); });
    })();
    return () => { left.abort(); };
  }, [planId, store]);
  return read;
}

/**
 * When the page is seen again, or its window gains focus, what another tab did
 * to the list is taken up. And as on the list page: a save still waiting (a
 * change made there a moment ago, or a print's record) starts as this page is
 * left, and is not tried again once it has gone; while one is waiting or being
 * kept the browser is asked to confirm leaving; and a page the browser brings
 * back from its back-forward cache is on the screen again.
 */
function useTakeUpOtherTabs(): void {
  useEffect(() => {
    const takeUp = (): void => { void useGuestListStore.getState().refresh(); };
    const gone = (): void => { useGuestListStore.getState().pageGone(); };
    const back = (event: PageTransitionEvent): void => {
      if (event.persisted) useGuestListStore.getState().pageHere();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") takeUp();
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
    window.addEventListener("pagehide", gone);
    window.addEventListener("pageshow", back);
    window.addEventListener("beforeunload", onLeaving);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", takeUp);
      window.removeEventListener("pagehide", gone);
      window.removeEventListener("pageshow", back);
      window.removeEventListener("beforeunload", onLeaving);
    };
  }, []);
}

function GuestPaper({ planId, store }: { readonly planId: string; readonly store: GuestListStore }): ReactElement {
  const openPlan = useGuestListStore((s) => s.planId);
  const phase = useGuestListStore((s) => s.phase);
  const list = useGuestListStore((s) => s.list);
  const read = useOpenedList(planId, store);
  // While this page is here, a save another tab was busy over is tried again; once it has gone, nothing is.
  useEffect(() => {
    useGuestListStore.getState().pageHere();
    return () => { useGuestListStore.getState().pageGone(); };
  }, []);
  useTakeUpOtherTabs();

  let body: ReactElement;
  if (!read || openPlan !== planId || phase === "opening" || (phase === "ready" && list === null)) {
    body = (
      <div className="gp-waiting">
        <ActivityStatus variant="panel">Opening your guest list…</ActivityStatus>
      </div>
    );
  } else if (phase === "unreadable" || list === null) {
    body = <Unreadable planId={planId} />;
  } else {
    body = <ReadyPaper planId={planId} list={list} />;
  }
  return <div className="gp" data-register="ivory" data-testid="guest-paper-page">{body}</div>;
}

function Unreadable({ planId }: { readonly planId: string }): ReactElement {
  return (
    <main className="gp-alone">
      <h1 className="gp-alone__title">{PAGE_TITLE}</h1>
      <p className="gp-alone__lede">A list was kept here for this plan, but it cannot be read.</p>
      <p className="gp-alone__action">
        <Link className="gp-button gp-button--primary" to={listAddress(planId)}>Back to the list</Link>
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** Waits for the page's faces, so the paper is never set in a stand-in font. */
async function fontsLoaded(): Promise<void> {
  // Typed as always present, but a browser without the Font Loading API has none.
  if (!("fonts" in document)) return;
  try {
    await document.fonts.ready;
  } catch {
    // Print with the faces that did load.
  }
}

/**
 * Records a print on the list (its version and day) and puts it on the page at
 * once, so the paper the browser lays out next carries it. Not a change undo
 * steps back through. A print alone never writes over another tab's list:
 * when its save finds one, their list is kept, with this print recorded on it
 * as made from an older copy, and the page says so. With an ordinary change
 * waiting too, the save is that change's: this tab's list is kept, as for any
 * change, and the page says that instead.
 */
function recordPrint(): void {
  const at = new Date().toISOString();
  let printed = 0;
  flushSync(() => {
    useGuestListStore.getState().apply(
      (l) => {
        const next = markPrinted(l, at);
        printed = next.paperVersion;
        return next;
      },
      { undo: false, ifOtherCopy: (theirs) => printedFromOlderCopy(theirs, printed, at) },
    );
  });
}

/** Print: the fonts, then the version recorded and kept on the device, then the browser's print. */
function usePrint(): { readonly printing: boolean; readonly print: () => void } {
  const busy = useRef(false);
  /** True only while the button's own call of the browser's print runs: the print it fires is already recorded. */
  const ours = useRef(false);
  /** False once the planner has left the paper: what is on screen then is another page. */
  const here = useRef(false);
  const [printing, setPrinting] = useState(false);

  // The browser's own Print command (a menu, a keyboard shortcut) records the
  // version too, so a list changed since its last print does not go out under
  // that print's number. It makes no read of the device first and waits for
  // no lock: the browser lays the sheet out as this handler returns, so
  // anything awaited here would print the old number. The reads at each
  // mount, on focus and when the page is seen again are what keep the list
  // current before it. In the moment before such a read returns, or while a
  // change is waiting here (nothing is read then), the sheet can be of an
  // older copy, and can then share its number with a sheet another tab has
  // printed. That cannot be prevented here, and what the save that follows
  // does depends on what was waiting. With nothing else waiting, it keeps
  // the other tab's list, and the page says not to use the printout. With a
  // change already waiting here, this tab's list is kept, the page says only
  // that this tab's version was kept, the two sheets share the number, and
  // the next print takes the next one. What holds in both: no later sheet is
  // given a number a sheet has carried.
  useEffect(() => {
    here.current = true;
    const onBeforePrint = (): void => {
      // The button records its own print before it opens the dialog. Every other print is recorded
      // here, one asked of the browser while the button is still waiting included: that sheet goes
      // out too, and its print is recorded like any other.
      if (ours.current) return;
      recordPrint();
      void useGuestListStore.getState().flush();
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      here.current = false;
      window.removeEventListener("beforeprint", onBeforePrint);
    };
  }, []);

  // Read afresh after each wait: the planner may leave while one runs.
  const stillHere = (): boolean => here.current;
  /** The print's save found another tab's list and gave way to it: the page state says so in its notice. */
  const gaveWay = (): boolean => useGuestListStore.getState().notice?.kind === "print-of-older-copy";
  /** The page's list says it has changed since its last print. */
  const changedSincePrint = (): boolean => useGuestListStore.getState().list?.changedSincePrint === true;
  /** A save or a read since took up an empty list in place of one that is no longer stored. */
  const foundGone = (takenUpBefore: number): boolean => {
    const { takeUps, notice } = useGuestListStore.getState();
    return takeUps !== takenUpBefore && (notice?.kind === "removed-elsewhere" || notice?.kind === "removed-by-rule");
  };

  const run = async (): Promise<void> => {
    try {
      // The word that an earlier press was held is put away: this press answers it.
      if (useGuestListStore.getState().notice?.kind === "print-held") useGuestListStore.getState().dismissNotice();
      await fontsLoaded();
      if (!stillHere()) return;
      const takenUp = useGuestListStore.getState().takeUps;
      // A change still waiting here is kept first. The read below reads nothing while one waits;
      // and when that save goes over a copy another tab has printed, their print record comes
      // with it before this print takes its number.
      await useGuestListStore.getState().flush();
      if (!stillHere()) return;
      // That save found the list gone (deleted in another tab, or removed under the rule). There
      // is nothing to print, and the page says so; recording a print would store an empty list
      // again.
      if (foundGone(takenUp)) return;
      // That save found another tab busy with the list, so the change is still not kept. The
      // button stops here, with nothing recorded, and the page says nothing was printed.
      if (useGuestListStore.getState().holdPrint()) return;
      // A print is of the newest list kept on this device: another tab's change is taken up first.
      await useGuestListStore.getState().refresh();
      if (!stillHere()) return;
      // That read found the list gone, as the save before it might have.
      if (foundGone(takenUp)) return;
      recordPrint();
      await useGuestListStore.getState().flush();
      if (!stillHere()) return;
      // The save of that record found the list gone (another tab's delete can land while this
      // save waits for the lock that tab holds): no dialog opens on an empty sheet.
      if (foundGone(takenUp)) return;
      // Or it found another tab busy, so the sheet's number is not on the device. No dialog opens:
      // a sheet that left now could share its number with a later one. The page says nothing was
      // printed and the button is free; pressed again once that tab has finished, it keeps the
      // record and prints once, under the same number when the list has not changed since.
      if (useGuestListStore.getState().holdPrint()) return;
      // Nothing has been printed yet, and the save of that record may have met another tab's copy.
      // Either it gave way (another tab saved in the moment between the read and the save): the
      // page now shows their list, with the print recorded on it as made from an older copy.
      // There is no older printout to speak of, so those words are put away. Or it went over
      // their copy with a change that was still waiting here, and their print record came with
      // it: their sheet has the number just recorded, or a larger one. Either way the page's list
      // now says it has changed since its print, so the print is recorded once more, on the list
      // the page shows, under the next number. Unless that second save finds the list gone or
      // another tab busy, the dialog opens on the list now on the page, whatever else it finds,
      // and no later sheet is given its number.
      if (gaveWay() || changedSincePrint()) {
        if (gaveWay()) useGuestListStore.getState().dismissNotice();
        recordPrint();
        await useGuestListStore.getState().flush();
        if (!stillHere()) return;
        // As after the first record: no dialog over a list found gone, or while the record waits on a busy tab.
        if (foundGone(takenUp)) return;
        if (useGuestListStore.getState().holdPrint()) return;
        if (gaveWay()) useGuestListStore.getState().dismissNotice();
      }
      ours.current = true;
      try {
        window.print();
      } finally {
        ours.current = false;
      }
    } finally {
      busy.current = false;
      setPrinting(false);
    }
  };

  const print = (): void => {
    if (busy.current) return;
    busy.current = true;
    setPrinting(true);
    void run();
  };

  return { printing, print };
}

// ---------------------------------------------------------------------------
// The page: the tools, then the sheet
// ---------------------------------------------------------------------------

function ReadyPaper({ planId, list }: { readonly planId: string; readonly list: GuestList }): ReactElement {
  const { search } = useLocation();
  const kept = useGuestListStore((s) => s.kept);
  const unread = useGuestListStore((s) => s.unread);
  const notice = useGuestListStore((s) => s.notice);
  const { printing, print } = usePrint();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sheet = sheetFrom(search);
  const label = SHEETS.find((entry) => entry.sheet === sheet)?.label ?? "Table plan";
  const plan = tablePlanAZ(list);
  const seated = list.guests.length - plan.notSeated;

  /** Its Close goes with the notice, so the focus goes to the tools' heading. */
  const closeNotice = (): void => {
    useGuestListStore.getState().dismissNotice();
    headingRef.current?.focus();
  };

  return (
    <div className="gp-desk">
      <header className="gp-tools" data-testid="guest-paper-tools">
        <div className="gp-tools__head">
          <h1 className="gp-tools__title" ref={headingRef} tabIndex={-1}>{label}</h1>
          <p className="gp-tools__count">{countWords(sheet, seated)}</p>
          <p className="gp-tools__version">{versionLine(list)}</p>
          {plan.notSeated > 0 && (
            <p className="gp-tools__gap">
              {`${counted(plan.notSeated, "guest has", "guests have")} no seat, so they are not on it`}
            </p>
          )}
        </div>
        {/* Always on the page, so a notice that appears in it is announced; the two that warn of losing work are alerts. */}
        <div className="gp-tools__notices" role="status">
          {unread
            ? <p className="gp-tools__notice" role="alert">{NOT_OPENED}</p>
            : !kept && <p className="gp-tools__notice" role="alert">{NOT_KEPT}</p>}
          {/* What became of the list outside this page. A repair's count is the list page's to say; here the tools' "no seat" line shows it. */}
          {notice !== null && notice.kind !== "repaired" && (
            <div className="gp-tools__notice" data-notice={notice.kind} data-tone="attention">
              <p>{noticeWords(notice)}</p>
              <button type="button" className="gp-link" onClick={closeNotice}>Close</button>
            </div>
          )}
        </div>
        <div className="gp-tools__row">
          <nav aria-label="Sheets">
            <ul className="gp-sheets">
              {SHEETS.map((entry) => (
                <li key={entry.sheet}>
                  <Link
                    className="gp-sheets__link"
                    to={sheetAddress(planId, search, entry.sheet)}
                    aria-current={entry.sheet === sheet ? "page" : undefined}
                  >
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="gp-actions">
            <button
              type="button"
              className="gp-button gp-button--primary"
              aria-busy={printing}
              aria-disabled={printing}
              onClick={print}
            >
              {printing && <ActivityIndicator size={16} />}
              Print
            </button>
            <Link className="gp-button" to={listAddress(planId)}>Back to the list</Link>
          </div>
        </div>
      </header>

      <main className="gp-paper">
        {sheet === "table-plan" && <TablePlanSheet list={list} />}
        {sheet === "by-table" && <ByTableSheet list={list} />}
        {sheet === "place-cards" && <PlaceCardsSheet list={list} />}
        {sheet === "covers" && <CoversSheet list={list} />}
      </main>
    </div>
  );
}

/**
 * A list sheet's frame: the sheet, its one foot on screen, and the version
 * footer paper repeats on every printed page. It is a real table because a
 * browser repeats a footer group on every printed page only for a real
 * <tfoot> (Chromium prints a <div> styled as one once, on the last page). The
 * footer sits in the flow, so the room for it is kept and it never covers a
 * name. On screen the table and its parts are plain blocks and the footer is
 * hidden; to assistive technology the table is no table (role="presentation")
 * and the footer is silent, as the sheet's own foot already says the version.
 * The cards, cut apart, have no frame.
 */
function PrintFrame({ list, children }: { readonly list: GuestList; readonly children: ReactNode }): ReactElement {
  const line = versionLine(list);
  return (
    <table className="gp-frame" role="presentation">
      <tbody className="gp-frame__body">
        <tr className="gp-frame__row">
          <td className="gp-frame__cell">
            {children}
            <footer className="gp-foot">{line}</footer>
          </td>
        </tr>
      </tbody>
      <tfoot className="gp-running" aria-hidden="true">
        <tr className="gp-frame__row">
          <td className="gp-frame__cell">
            <p className="gp-running__line">{line}</p>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

// ---------------------------------------------------------------------------
// The sheets. Each renders what paper.ts gives it and decides nothing itself.
// ---------------------------------------------------------------------------

/** The table plan for the door: the seated guests A to Z under their letters, each with a table number. */
function TablePlanSheet({ list }: { readonly list: GuestList }): ReactElement {
  const titleId = useId();
  const plan = tablePlanAZ(list);
  const day = eventDay(list);
  return (
    <article className="gp-leaf gp-leaf--poster" aria-labelledby={titleId} data-testid="guest-paper-sheet" data-sheet="table-plan" translate="no">
      <PrintFrame list={list}>
        {day !== null && <p className="gp-eyebrow">{day}</p>}
        <h2 className="gp-leaf__title" id={titleId}>{list.title.trim() !== "" ? list.title : "Table plan"}</h2>
        <p className="gp-leaf__sub">Please find your table</p>
        <div className="gp-az">
          {plan.groups.map((group) => {
            const [first, ...rest] = group.entries;
            return (
              <section key={group.letter} className="gp-az__group">
                {/* A letter's heading and its first name stay together on paper. */}
                <div className="gp-az__lead">
                  <h3 className="gp-az__letter">{group.letter}</h3>
                  {first !== undefined && <PlanEntry label={first.label} table={first.table} />}
                </div>
                {rest.map((entry, at) => <PlanEntry key={at} label={entry.label} table={entry.table} />)}
              </section>
            );
          })}
        </div>
      </PrintFrame>
    </article>
  );
}

function PlanEntry({ label, table }: { readonly label: string; readonly table: number }): ReactElement {
  return (
    <p className="gp-az__entry">
      <span className="gp-az__name">{label}</span>
      <span className="gp-az__leader" aria-hidden="true" />
      <span className="gp-az__table"><span className="gp-sr-only">table </span>{String(table)}</span>
    </p>
  );
}

/** Each table by number, with the planner's own name for it and its guests by seat. */
function ByTableSheet({ list }: { readonly list: GuestList }): ReactElement {
  const titleId = useId();
  const day = eventDay(list);
  const eyebrow = [list.title.trim(), day ?? ""].filter((part) => part !== "").join(" · ");
  return (
    <article className="gp-leaf" aria-labelledby={titleId} data-testid="guest-paper-sheet" data-sheet="by-table" translate="no">
      <PrintFrame list={list}>
        {eyebrow !== "" && <p className="gp-eyebrow">{eyebrow}</p>}
        <h2 className="gp-leaf__title" id={titleId}>Guests by table</h2>
        <div className="gp-tables">
          {byTable(list).map((table) => (
            <section key={table.number} className="gp-table" aria-label={`Table ${String(table.number)}`}>
              <h3 className="gp-table__head">
                <span className="gp-table__number">{`Table ${String(table.number)}`}</span>
                {table.name.trim() !== "" && <span className="gp-table__name">{table.name}</span>}
              </h3>
              <ol className="gp-table__seats">
                {table.guests.map((guest) => (
                  <li key={guest.seat}>
                    <span className="gp-table__seat">{String(guest.seat)}</span>
                    <span className="gp-table__guest">{guest.name}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </PrintFrame>
    </article>
  );
}

/**
 * One card a seated guest, ten to an A4 page, each with its cut marks. Cards
 * are cut apart, so no version line is printed on them: the version is in the
 * tools on screen.
 */
function PlaceCardsSheet({ list }: { readonly list: GuestList }): ReactElement {
  const pages = inPages(placeCards(list), CARDS_A_PAGE);
  return (
    <article className="gp-cards-sheet" aria-label="Place cards" data-testid="guest-paper-sheet" data-sheet="place-cards" translate="no">
      <style>{CARDS_PAGE_STYLE}</style>
      <div className="gp-cards">
        {pages.map((page, number) => (
          <div key={number} className="gp-cards-page">
            {page.map((card, at) => (
              <div key={at} className="gp-card">
                <span className="gp-cut" aria-hidden="true" />
                <span className="gp-card__name" data-step={card.step}>{card.name}</span>
                <span className="gp-card__table">{`Table ${String(card.table)}`}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * Covers by table, for the caterer. No guest's name, no table's own name and
 * no event name (any of which can be a person's) is on this sheet.
 */
function CoversSheet({ list }: { readonly list: GuestList }): ReactElement {
  const titleId = useId();
  const counts = covers(list);
  const day = eventDay(list);
  return (
    <article className="gp-leaf gp-leaf--small" aria-labelledby={titleId} data-testid="guest-paper-sheet" data-sheet="covers" translate="no">
      <PrintFrame list={list}>
        <p className="gp-eyebrow">{day === null ? "For the caterer · covers by table" : `For the caterer · covers by table · ${day}`}</p>
        <h2 className="gp-leaf__title" id={titleId}>
          {`${counted(counts.total, "cover", "covers")}, ${counted(counts.tables.length, "table", "tables")}`}
        </h2>
        <div className="gp-covers">
          {counts.tables.map((table) => (
            <p key={table.number} className="gp-covers__line">
              <span>{`Table ${String(table.number)}`}</span>
              <b>{String(table.covers)}</b>
            </p>
          ))}
        </div>
        <p className="gp-covers__note">
          No guest's name is on this sheet. Diets and allergies are not held here: ask each guest, or give the kitchen a count.
        </p>
      </PrintFrame>
    </article>
  );
}
