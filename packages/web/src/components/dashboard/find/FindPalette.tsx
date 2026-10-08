import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import * as clientsApi from "../../../api/clients.js";
import { getCalendar } from "../../../api/diary.js";
import { useEscapeToClose, useFocusTrap } from "../../../lib/use-focus-trap.js";
import { boardRange, msToWallInput } from "../../../pages/diary/lib/board-time.js";
import { dayAnswer } from "../../../pages/diary/lib/day-answer.js";
import { ActivityStatus } from "../../shared/Activity.js";
import {
  activeKeyAfter, buildFindGroups, dayAnswerSaid, findScope, FIND_SEARCH_MAX, normaliseQuery, rowsOf, soughtDate, wantsClientSearch,
  type FindClients, type FindDayAnswer, type FindPlace, type FindRow, type FindSource, type FindTarget,
} from "./find-model.js";
import "./FindPalette.css";

// ---------------------------------------------------------------------------
// Find (T-635, roadmap Tier A #8), opened from the staff header or Ctrl/⌘K.
//
// The input is a combobox over one listbox: focus stays in the input, so
// typing never stops, and the arrow keys move the row Enter opens. The query
// lives here, so a keystroke renders Find alone, never the page behind it (the
// Diary's render budget depends on that). Dates, pages and the page's own
// findings answer at once; the client search follows a moment after typing
// settles, and only its answer to the words now shown is used.
// ---------------------------------------------------------------------------

/** Typing settles for this long before the client search is asked. */
const SEARCH_DELAY_MS = 200;

export interface FindPaletteProps {
  /** The pages the header offers this person, in its order. */
  readonly places: readonly FindPlace[];
  /** Whether the client search answers this person (the shell decides). */
  readonly canSearchClients: boolean;
  /** The venue whose Diary answers a date in place, or null where the Diary
   *  is not this person's to read (Find then offers the date as a way in). */
  readonly diaryVenueId: string | null;
  /** What the page showing adds (the Diary's board), or null. */
  readonly source: FindSource | null;
  readonly onOpen: (target: FindTarget) => void;
  readonly onClose: () => void;
}

/** A day's answer as Find holds it: only the answer for the day now sought counts. */
type DayState =
  | { readonly iso: string; readonly status: "loading" }
  | { readonly iso: string; readonly status: "ready"; readonly answer: FindDayAnswer }
  | { readonly iso: string; readonly status: "error" };

/** Typing settles for this long before the Diary is read for a date. */
// Long enough that "14 nov 20", on its way to "14 nov 2026", is not read as 2020.
const DAY_DELAY_MS = 300;

export function FindPalette({ places, canSearchClients, diaryVenueId, source, onOpen, onClose }: FindPaletteProps): ReactElement {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const scopeId = `${baseId}-scope`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const query = normaliseQuery(text);
  const [clients, setClients] = useState<FindClients | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<{ readonly key: string | null; readonly moved: boolean }>({ key: null, moved: false });
  // The venue's own day, for "14 Nov" and "today".
  const [today] = useState(() => msToWallInput(Date.now()).slice(0, 10));
  // Whether a press began and ended on the backdrop: only such a press puts
  // Find away, and on its click, so a tap never falls through to the page
  // beneath once Find has gone, and a drag between sheet and backdrop never
  // closes it.
  const pressedBackdrop = useRef(false);
  const releasedBackdrop = useRef(false);
  // An input method's composition owns Enter, Escape and the arrows. Safari
  // ends the composition before the key that ended it arrives, so the flag
  // stays up until that key has passed.
  const composing = useRef(false);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  useEscapeToClose(() => { if (!composing.current) onClose(); });

  useEffect(() => { inputRef.current?.focus(); }, []);

  // What the page holds can change while Find is open (a board still loading,
  // a live change): Find renders again when it says so, and reads it afresh.
  const [, setPageChanged] = useState(0);
  useEffect(() => (source === null ? undefined : source.subscribe(() => { setPageChanged((count) => count + 1); })), [source]);

  // A date is answered in place, room by room, in the Diary's own words, so
  // "is the Grand Hall free on the 14th?" needs no page to be left. Each day
  // is read once while Find is open; a newer date cancels an older read.
  const sought = soughtDate(query, today, places);
  const [day, setDay] = useState<DayState | null>(null);
  const daysRead = useRef(new Map<string, FindDayAnswer>());
  useEffect(() => {
    if (sought === null || diaryVenueId === null) return;
    const known = daysRead.current.get(sought);
    if (known !== undefined) {
      setDay({ iso: sought, status: "ready", answer: known });
      return;
    }
    const reading = new AbortController();
    const timer = window.setTimeout(() => {
      setDay({ iso: sought, status: "loading" });
      const range = boardRange(Date.parse(`${sought}T12:00:00.000Z`), "day");
      getCalendar(diaryVenueId, new Date(range.fromMs).toISOString(), new Date(range.toMs).toISOString(), reading.signal)
        .then((calendar) => {
          const rooms = dayAnswer(calendar.entries, calendar.rooms, { startMs: range.fromMs, endMs: range.toMs }, Date.now())
            .map((room) => ({ id: room.id, name: room.name, lines: room.lines.map((line) => line.text), free: room.free }));
          const answer: FindDayAnswer = { iso: sought, rooms };
          daysRead.current.set(sought, answer);
          // A read that a newer date replaced may still answer: it fills the
          // cache for its own day, and never takes the newer day's place.
          if (!reading.signal.aborted) setDay({ iso: sought, status: "ready", answer });
        })
        .catch(() => { if (!reading.signal.aborted) setDay({ iso: sought, status: "error" }); });
    }, DAY_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      reading.abort();
    };
  }, [diaryVenueId, sought]);
  const shownDay = day !== null && day.iso === sought ? day : null;

  const searching = wantsClientSearch(query, canSearchClients, today);
  useEffect(() => {
    if (!searching) {
      setClients(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      setClients({ status: "loading", query });
      clientsApi.searchClients(query)
        .then((results) => { if (current) setClients({ status: "ready", query, results }); })
        .catch(() => { if (current) setClients({ status: "error", query }); });
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, searching, attempt]);

  // Read on every render of Find: the page's findings are an in-memory match
  // over what it already holds, and a render here never renders the page.
  const board = source === null ? null : { label: source.label, rows: source.find(query) };
  const groups = buildFindGroups({
    query, today, places, board, canSearchClients, clients,
    dayAnswer: shownDay?.status === "ready" ? shownDay.answer : null,
  });
  const rows = rowsOf(groups);
  const activeKey = activeKeyAfter(rows, cursor.key, cursor.moved);
  const optionIds = new Map(rows.map((row, index) => [row.key, `${baseId}-option-${String(index)}`]));
  const activeId = activeKey === null ? undefined : optionIds.get(activeKey);

  useEffect(() => {
    if (activeId === undefined) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const open = (row: FindRow): void => { onOpen(row.target); };

  const move = (step: number): void => {
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.key === activeKey);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + step))];
    if (next !== undefined) setCursor({ key: next.key, moved: true });
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || composing.current) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      const row = rows.find((candidate) => candidate.key === activeKey);
      if (row === undefined) return;
      event.preventDefault();
      open(row);
    }
  };

  const shownClients = clients !== null && clients.query === query ? clients : null;
  const clientsFound = shownClients?.status === "ready"
    ? groups.some((group) => group.key !== "search" && group.key !== "date" && group.key !== "board" && group.key !== "pages")
    : false;
  const placeholder = canSearchClients ? "A name, a date or a page" : "A date or a page";
  // One polite region, always present, says when nothing was found, so the
  // words are announced as they change rather than inserted with their region.
  // A date's answer is said in short when it arrives ("…: 5 of 8 rooms free."),
  // as the row's own name changing is not announced.
  const said = rows.length === 0
    ? (query === "" ? "Nothing to open yet." : `Nothing found for “${query}”.`)
    : shownDay?.status === "ready" ? dayAnswerSaid(shownDay.answer)
      : shownClients?.status === "ready" && !clientsFound ? `No clients found for “${query}”.` : "";

  return (
    <div
      className="find-backdrop"
      onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
      onPointerUp={(event) => { releasedBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        const onBackdrop = pressedBackdrop.current && releasedBackdrop.current;
        pressedBackdrop.current = false;
        releasedBackdrop.current = false;
        if (onBackdrop && event.target === event.currentTarget) onClose();
      }}
      // A press anywhere but Find's field and buttons, the backdrop included,
      // keeps the cursor in the field, so no keystroke falls to the page.
      onMouseDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("input, button") === null) event.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        className="find"
        role="dialog"
        aria-modal="true"
        aria-label="Find"
        data-register="ivory"
      >
        <div className="find__field">
          <Search size={20} aria-hidden="true" className="find__icon" />
          <input
            ref={inputRef}
            className="find__input"
            type="text"
            role="combobox"
            aria-label="Find"
            aria-expanded={rows.length > 0}
            aria-controls={rows.length > 0 ? listId : undefined}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-describedby={scopeId}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            maxLength={FIND_SEARCH_MAX}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setCursor({ key: null, moved: false });
            }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { window.setTimeout(() => { composing.current = false; }, 0); }}
            onKeyDown={onInputKey}
          />
          <button type="button" className="find__close" aria-label="Close Find" aria-keyshortcuts="Escape" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="find__scope" id={scopeId}>{findScope(places, source !== null, canSearchClients)}</p>

        {rows.length > 0 && (
          <div className="find__list" id={listId} role="listbox" aria-label="Found">
            {groups.map((group) => {
              const headingId = `${baseId}-group-${group.key}`;
              return (
                <div key={group.key} role="presentation" className="find__section">
                  {group.label !== null && (
                    <div role="presentation" id={headingId} className="find__group">{group.label}</div>
                  )}
                  <div role="group" aria-labelledby={group.label === null ? undefined : headingId}
                    aria-label={group.label === null ? "Clients desk" : undefined}>
                    {group.rows.map((row) => {
                      const selected = row.key === activeKey;
                      return (
                        <div
                          key={row.key}
                          id={optionIds.get(row.key)}
                          role="option"
                          aria-selected={selected}
                          aria-label={row.label}
                          className={`find__row${selected ? " find__row--active" : ""}${group.key === "search" ? " find__row--search" : ""}`}
                          onPointerMove={() => {
                            if (!selected) setCursor({ key: row.key, moved: true });
                          }}
                          onClick={() => { open(row); }}
                        >
                          <span className="find__title">{row.title}</span>
                          {row.answer !== undefined && (
                            <span className="find__answer" aria-hidden="true">
                              {row.answer.map((room) => (
                                <span key={room.id} className={`find__answer-room${room.free ? " find__answer-room--free" : ""}`}>
                                  <span className="find__answer-name">{room.room}</span>
                                  <span className="find__answer-lines">
                                    {room.lines.map((line, index) => (
                                      <span key={`${room.id}-${String(index)}`} className="find__answer-text">{line}</span>
                                    ))}
                                  </span>
                                </span>
                              ))}
                            </span>
                          )}
                          {row.detail !== "" && <span className="find__detail">{row.detail}</span>}
                          {row.target.kind === "href" && row.target.newTab && (
                            <ArrowUpRight size={16} aria-hidden="true" className="find__out" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className={`find__said${rows.length === 0 ? " find__said--empty" : ""}`} role="status">{said}</p>

        <div className="find__status">
          {shownDay?.status === "loading" && <ActivityStatus>Reading the Diary for that day…</ActivityStatus>}
          {shownDay?.status === "error" && (
            <p className="find__quiet">The Diary could not be read for that day. Enter opens it there.</p>
          )}
          {shownClients?.status === "loading" && <ActivityStatus>Searching clients…</ActivityStatus>}
          {shownClients?.status === "error" && (
            <p className="find__alert" role="alert">
              Clients could not be searched.
              <button type="button" className="find__retry" onClick={() => {
                setAttempt((count) => count + 1);
                inputRef.current?.focus();
              }}>Try again</button>
            </p>
          )}
        </div>
        <p className="find__keys" aria-hidden="true">
          <kbd>↑</kbd><kbd>↓</kbd> to move <span>·</span> <kbd>Enter</kbd> to open <span>·</span> <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
