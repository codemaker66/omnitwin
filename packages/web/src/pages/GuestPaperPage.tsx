import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { KitGate } from "../components/guest-list/KitGate.js";
import { calendarDay, counted, NOT_KEPT, weekday } from "../components/guest-list/words.js";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import { KIT_PARAM } from "../lib/guest-list/kit-switch.js";
import type { GuestList } from "../lib/guest-list/model.js";
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
// tools: which sheet, its count, the four sheets, Print and the way back.
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

// The day of a print is told as the controller's decisions set it: a UTC day.
const PRINTED_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

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

/** The foot of every sheet: "Version 6 · printed 13 November 2026", or "Not yet printed". */
function versionLine(list: GuestList): string {
  if (list.paperVersion === 0 || list.printedAt === null) return "Not yet printed";
  return `Version ${String(list.paperVersion)} · printed ${PRINTED_DAY.format(Date.parse(list.printedAt))}`;
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

/** Removes lists past their day, then opens this plan's list (unless it is open already). */
function useOpenedList(planId: string, store: GuestListStore): void {
  useEffect(() => {
    const left = new AbortController();
    void (async () => {
      // The sweep goes first, so a list past its removal day is never printed.
      try {
        await store.sweep(Date.now());
      } catch {
        // A tidy-up only: the list still opens.
      }
      if (left.signal.aborted) return;
      const page = useGuestListStore.getState();
      if (page.planId !== planId) await page.open(planId, store);
    })();
    return () => { left.abort(); };
  }, [planId, store]);
}

function GuestPaper({ planId, store }: { readonly planId: string; readonly store: GuestListStore }): ReactElement {
  const openPlan = useGuestListStore((s) => s.planId);
  const phase = useGuestListStore((s) => s.phase);
  const list = useGuestListStore((s) => s.list);
  useOpenedList(planId, store);

  let body: ReactElement;
  if (openPlan !== planId || phase === "opening" || (phase === "ready" && list === null)) {
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
 * steps back through.
 */
function recordPrint(): void {
  flushSync(() => {
    useGuestListStore.getState().apply((l) => markPrinted(l, new Date().toISOString()), { undo: false });
  });
}

/** Print: the fonts, then the version recorded and kept on the device, then the browser's print. */
function usePrint(): { readonly printing: boolean; readonly print: () => void } {
  const busy = useRef(false);
  const [printing, setPrinting] = useState(false);

  // The browser's own Print command (a menu, a keyboard shortcut) records the
  // version too, so no sheet goes out carrying an earlier version's number.
  useEffect(() => {
    const onBeforePrint = (): void => {
      if (busy.current) return;
      recordPrint();
      void useGuestListStore.getState().flush();
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => { window.removeEventListener("beforeprint", onBeforePrint); };
  }, []);

  const run = async (): Promise<void> => {
    try {
      await fontsLoaded();
      recordPrint();
      await useGuestListStore.getState().flush();
      window.print();
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
  const { printing, print } = usePrint();
  const sheet = sheetFrom(search);
  const label = SHEETS.find((entry) => entry.sheet === sheet)?.label ?? "Table plan";
  const plan = tablePlanAZ(list);
  const seated = list.guests.length - plan.notSeated;

  return (
    <div className="gp-desk">
      <header className="gp-tools" data-testid="guest-paper-tools">
        <div className="gp-tools__head">
          <h1 className="gp-tools__title">{label}</h1>
          <p className="gp-tools__count">{countWords(sheet, seated)}</p>
          {plan.notSeated > 0 && (
            <p className="gp-tools__gap">
              {`${counted(plan.notSeated, "guest has", "guests have")} no seat, so they are not on it`}
            </p>
          )}
        </div>
        {!kept && <p className="gp-tools__notice">{NOT_KEPT}</p>}
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

function Foot({ list, className = "gp-foot" }: { readonly list: GuestList; readonly className?: string }): ReactElement {
  return <footer className={className}>{versionLine(list)}</footer>;
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
    <article className="gp-leaf gp-leaf--poster" aria-labelledby={titleId} data-testid="guest-paper-sheet" data-sheet="table-plan">
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
      <Foot list={list} />
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
    <article className="gp-leaf" aria-labelledby={titleId} data-testid="guest-paper-sheet" data-sheet="by-table">
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
      <Foot list={list} />
    </article>
  );
}

/** One card a seated guest, ten to an A4 page, each with its cut marks; the version follows the last page. */
function PlaceCardsSheet({ list }: { readonly list: GuestList }): ReactElement {
  const pages = inPages(placeCards(list), CARDS_A_PAGE);
  return (
    <article className="gp-cards-sheet" aria-label="Place cards" data-testid="guest-paper-sheet" data-sheet="place-cards">
      <div className="gp-cards">
        {pages.map((page, number) => (
          <div key={number} className="gp-cards-page">
            {page.map((card, at) => (
              <div key={at} className="gp-card">
                <span className="gp-cut" aria-hidden="true" />
                <span className="gp-card__name">{card.name}</span>
                <span className="gp-card__table">{`Table ${String(card.table)}`}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Foot list={list} className="gp-foot gp-cards__foot" />
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
    <article className="gp-leaf gp-leaf--small" aria-labelledby={titleId} data-testid="guest-paper-sheet" data-sheet="covers">
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
      <Foot list={list} />
    </article>
  );
}
