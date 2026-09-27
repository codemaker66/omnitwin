import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { ArrowUpRight, Building2, FileText, LayoutGrid, Search, X } from "lucide-react";
import * as clientsApi from "../../api/clients.js";
import type { RecentEnquiry, SearchResults } from "../../api/clients.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityStatus } from "../shared/Activity.js";
import { deskGreeting, eventDateParts, eventLead, venueYear } from "./enquiries/enquiry-desk-format.js";
import { ClientPanel } from "./clients/ClientPanel.js";
import {
  enquiryStateWords, groupResults, groupStartingPoints, initials, rowLabel, sameClient,
  type ClientRef, type ResultGroup, type ResultRow,
} from "./clients/clients-desk-format.js";
import "./enquiries/EnquiriesDesk.css";
import "./clients/ClientsDesk.css";

// ---------------------------------------------------------------------------
// ClientsDesk — find a client while they are on the phone (roadmap X1).
//
// One search over people, organisations, deals, proposals and layouts, where
// a near spelling is found too ("Mcdonald" finds "MacDonald"). Before anything
// is typed the desk shows whose events come next and who was last in touch.
// A client opens in the forest panel beside the list, with its place in the
// address (?client=), so a reload returns to it and the browser's Back closes
// it onto the same results (?q=). "/" puts the cursor in the search from
// anywhere on the desk; the arrow keys, j and k move through what it found.
// ---------------------------------------------------------------------------

const WIDE_DESK = "(min-width: 1180px)";
const SEARCH_DELAY_MS = 250;
/** The longest query the API accepts (routes/clients.ts SearchQuery). */
const SEARCH_MAX_LENGTH = 200;

export interface ClientsDeskProps {
  /** What the address says was searched for (?q=). */
  readonly query: string;
  /** The client the address has open (?client=), or null. */
  readonly client: ClientRef | null;
  readonly onQueryChange: (query: string) => void;
  /** Opens a client (a step the browser's Back undoes) or closes it (null). */
  readonly onClientChange: (client: ClientRef | null) => void;
  /** Whether this reader works the commercial record; the search finds none
   *  of it otherwise, and the desk does not promise it. */
  readonly canSeeCommercial: boolean;
  readonly onOpenDeal: (dealId: string) => void;
  readonly onOpenProposal: (proposalId: string) => void;
  readonly onViewEnquiry: (enquiryId: string) => void;
}

type SearchState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly query: string; readonly previous: SearchResults | null }
  | { readonly status: "ready"; readonly query: string; readonly results: SearchResults }
  | { readonly status: "error"; readonly query: string };

type StartState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly upcoming: readonly RecentEnquiry[]; readonly recent: readonly RecentEnquiry[] }
  | { readonly status: "error" };

const MOVE_KEYS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  j: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  k: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_, last) => last,
};

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

export function ClientsDesk(props: ClientsDeskProps): ReactElement {
  const { query, client, onQueryChange, onClientChange, canSeeCommercial } = props;
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const hintId = useId();
  const userName = useAuthStore((s) => s.user?.name ?? null);
  const [text, setText] = useState(query);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [start, setStart] = useState<StartState>({ status: "loading" });
  const [nowMs] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPanelRef = useRef(false);
  const returnFocusRef = useRef(false);
  const lastOpenedRef = useRef<string | null>(null);
  const previousClientRef = useRef<ClientRef | null>(client);

  // The address can change the query under the desk (Back, a link): follow it.
  useEffect(() => { setText((current) => (current.trim() === query ? current : query)); }, [query]);

  // Typing settles into the address, which is what is searched.
  useEffect(() => {
    if (text.trim() === query) return;
    const timer = window.setTimeout(() => { onQueryChange(text); }, SEARCH_DELAY_MS);
    return () => { window.clearTimeout(timer); };
  }, [onQueryChange, query, text]);

  useEffect(() => {
    if (query.length < 2) {
      setSearch({ status: "idle" });
      return;
    }
    let current = true;
    setSearch((previous) => ({ status: "loading", query, previous: previous.status === "ready" ? previous.results : null }));
    clientsApi.searchClients(query)
      .then((results) => { if (current) setSearch({ status: "ready", query, results }); })
      .catch(() => { if (current) setSearch({ status: "error", query }); });
    return () => { current = false; };
  }, [query, attempt]);

  // Before anything is typed: whose events come next, and who was last in touch.
  useEffect(() => {
    let current = true;
    Promise.all([clientsApi.getUpcomingClients(), clientsApi.getRecentEnquiries()])
      .then(([upcoming, recent]) => { if (current) setStart({ status: "ready", upcoming, recent }); })
      .catch(() => { if (current) setStart({ status: "error" }); });
    return () => { current = false; };
  }, []);

  // "/" finds the search from anywhere on the desk, as in the mail and
  // calendar tools a booker already uses.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, []);

  // Focus follows the reader into a client they opened, and back to its row
  // once the client closes, by its button, Escape or the browser's Back, and
  // the list is on screen again (on a phone it returns only then).
  useEffect(() => {
    const previous = previousClientRef.current;
    previousClientRef.current = client;
    if (client !== null) {
      if (focusPanelRef.current) {
        focusPanelRef.current = false;
        panelHeadingRef.current?.focus();
      }
      return;
    }
    if (previous === null) return;
    const active = document.activeElement;
    if (!returnFocusRef.current && active !== null && active !== document.body) return;
    returnFocusRef.current = false;
    // The row it was opened from, or (after a reload) the client's own row.
    const key = lastOpenedRef.current ?? `${previous.kind}:${previous.id}`;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
    (row ?? inputRef.current)?.focus();
  });

  const results = search.status === "ready" ? search.results : search.status === "loading" ? search.previous : null;
  const groups: ResultGroup[] = query.length >= 2
    ? (results === null ? [] : groupResults(results))
    : start.status === "ready" ? groupStartingPoints(start.upcoming, start.recent) : [];
  const found = groups.reduce((sum, group) => sum + group.rows.length, 0);
  // One row stands for the open client: the one it was opened from, or its
  // first row (a person comes before their organisation).
  const clientRows = client === null ? [] : groups.flatMap((group) => group.rows)
    .filter((row) => "ref" in row && sameClient(row.ref, client));
  const currentKey = (clientRows.find((row) => row.key === lastOpenedRef.current) ?? clientRows[0])?.key ?? null;

  const openClient = (ref: ClientRef, key: string): void => {
    lastOpenedRef.current = key;
    focusPanelRef.current = true;
    if (!sameClient(ref, client)) onClientChange(ref);
    else panelHeadingRef.current?.focus();
  };

  const activate = (row: ResultRow): void => {
    switch (row.kind) {
      case "user":
      case "lead":
      case "contact":
        openClient(row.ref, row.key);
        return;
      case "account":
        if (row.ref !== null) openClient(row.ref, row.key);
        return;
      case "deal":
        props.onOpenDeal(row.id);
        return;
      case "proposal":
        props.onOpenProposal(row.id);
        return;
      case "enquiry":
        if (row.ref !== null) openClient(row.ref, row.key);
        else props.onViewEnquiry(row.enquiryId);
        return;
      case "layout":
        return;
    }
  };

  const close = (): void => {
    returnFocusRef.current = true;
    onClientChange(null);
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const move = MOVE_KEYS[event.key];
    if (move === undefined) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [])];
    const index = rows.findIndex((row) => row === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    rows[move(index, rows.length - 1)]?.focus();
  };

  const clear = (): void => {
    setText("");
    onQueryChange("");
    inputRef.current?.focus();
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      const first = listRef.current?.querySelector<HTMLElement>("[data-row-key]");
      if (first !== null && first !== undefined) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === "Escape" && text !== "") {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  };

  const onDeskKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented || client === null) return;
    event.preventDefault();
    close();
  };

  const greeting = deskGreeting(nowMs, userName);
  const year = venueYear(nowMs);
  const showSheet = wide || client === null;
  const showPanel = client !== null;
  const scope = canSeeCommercial
    ? "Names, emails, organisations, deals and proposals. A near spelling finds them too."
    : "Names, emails and layouts. A near spelling finds them too.";

  return (
    <div className={`enq-desk cl-desk${wide ? "" : " enq-desk--single"}`}
      data-register="ivory" onKeyDown={onDeskKey}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <h1 id={titleId}>Clients</h1>
          </header>

          <div className="cl-search" role="search">
            <Search size={20} aria-hidden="true" className="cl-search__icon" />
            <input
              ref={inputRef}
              type="search"
              className="cl-search__input"
              aria-label="Search clients"
              aria-describedby={hintId}
              aria-keyshortcuts="/"
              placeholder="Search clients"
              autoComplete="off"
              spellCheck={false}
              maxLength={SEARCH_MAX_LENGTH}
              value={text}
              data-testid="search-input"
              onChange={(event) => { setText(event.target.value); }}
              onKeyDown={onInputKey}
            />
            {text === "" ? <kbd className="cl-search__key" aria-hidden="true">/</kbd> : (
              <button type="button" className="cl-search__clear" aria-label="Clear search" aria-keyshortcuts="Escape" onClick={clear}>
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="cl-search__hint" id={hintId}>{scope}</p>

          <p className="enq-count" aria-live="polite" data-testid="clients-count">
            {query.length >= 2 && search.status === "ready"
              ? (found === 0 ? `Nothing found for “${query}”. Check the spelling, or try an email address.`
                : `${found.toLocaleString("en-GB")} found for “${query}”.`)
              : null}
          </p>
          {query.length >= 2 && search.status === "loading" && (
            <ActivityStatus className="enq-sheet__activity">Searching…</ActivityStatus>
          )}
          {query.length >= 2 && search.status === "error" && (
            <div className="enq-notice enq-notice--alert" role="alert">
              <p>The search could not be run.</p>
              <button type="button" className="enq-button" onClick={() => { setAttempt((count) => count + 1); }}>Try again</button>
            </div>
          )}
          {query.length < 2 && start.status === "loading" && (
            <ActivityStatus className="enq-sheet__activity">Reading who is in touch…</ActivityStatus>
          )}
          {query.length < 2 && start.status === "error" && (
            <p className="cl-quiet-note">Who was last in touch could not be read. The search still works.</p>
          )}
          {query.length < 2 && start.status === "ready" && groups.length === 0 && (
            <div className="enq-empty">
              <h2>No clients yet</h2>
              <p>People appear here as they enquire.</p>
            </div>
          )}

          <div className="enq-ledger cl-ledger" ref={listRef} onKeyDown={moveFocus}>
            {groups.map((group, index) => (
              <section key={group.key} aria-labelledby={`${titleId}-group-${String(index)}`}>
                <h2 className="enq-group" id={`${titleId}-group-${String(index)}`}>
                  {group.label}
                  <span className="enq-group__count"><span className="vv-sr-only">, </span>{group.rows.length.toLocaleString("en-GB")}</span>
                </h2>
                <ul className="enq-rows">
                  {group.rows.map((row) => (
                    <li key={row.key}>
                      <ClientRow row={row} year={year} nowMs={nowMs}
                        open={row.key === currentKey}
                        onActivate={activate} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      )}

      {showPanel ? (
        <ClientPanel
          key={`${client.kind}:${client.id}`}
          client={client}
          layout={wide ? "wide" : "single"}
          headingRef={panelHeadingRef}
          onClose={close}
          onViewEnquiry={props.onViewEnquiry}
          onOpenDeal={props.onOpenDeal}
          onOpenProposal={props.onOpenProposal}
        />
      ) : wide ? (
        <aside className="enq-panel cl-panel" data-register="forest" aria-label="Clients overview">
          <div className="enq-panel__body enq-overview">
            <h2>Find anyone in a few letters</h2>
            <p>Type a name as you heard it. The client opens here, beside the list, with everything the venue holds for them.</p>
            <p className="enq-next__hint">Press <kbd className="cl-key">/</kbd> from anywhere on this page to search.</p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function ClientRow({ row, year, nowMs, open, onActivate }: {
  readonly row: ResultRow;
  readonly year: number;
  readonly nowMs: number;
  readonly open: boolean;
  readonly onActivate: (row: ResultRow) => void;
}): ReactElement {
  const date = "date" in row ? eventDateParts(row.date) : null;
  const passed = "date" in row && eventLead(row.date, nowMs) === "date has passed";
  const tile = row.kind === "deal" || row.kind === "enquiry" ? (
    date === null ? (
      <span className="enq-date enq-date--open" aria-hidden="true">
        <span className="enq-date__weekday">Date</span>
        <span className="enq-date__day">TBC</span>
      </span>
    ) : (
      <span className={`enq-date${passed ? " enq-date--past" : ""}`} aria-hidden="true">
        <span className="enq-date__weekday">{date.weekday}</span>
        <span className="enq-date__day">{date.day}</span>
        <span className="enq-date__month">{date.month}{Number(date.year) === year ? "" : ` ’${date.year.slice(2)}`}</span>
      </span>
    )
  ) : row.kind === "account" ? (
    <span className="cl-tile" aria-hidden="true"><Building2 size={20} strokeWidth={1.5} /></span>
  ) : row.kind === "proposal" ? (
    <span className="cl-tile cl-tile--proposal" aria-hidden="true"><FileText size={18} strokeWidth={1.5} /><span>v{row.version}</span></span>
  ) : row.kind === "layout" ? (
    <span className="cl-tile" aria-hidden="true"><LayoutGrid size={20} strokeWidth={1.5} /></span>
  ) : (
    <span className="cl-tile cl-tile--person" aria-hidden="true">{initials(row.title)}</span>
  );
  const body = (
    <>
      {tile}
      <span className="enq-row__main" aria-hidden="true">
        <span className="enq-row__title">{row.title}</span>
        {row.detail !== "" && <span className="enq-row__meta">{row.detail}</span>}
      </span>
      <span className="enq-row__side" aria-hidden="true">
        {row.kind === "enquiry" && <span className="enq-chip cl-chip">{enquiryStateWords(row.state)}</span>}
        {row.kind === "layout" && <ArrowUpRight size={16} />}
      </span>
    </>
  );
  if (row.kind === "layout") {
    return (
      <a className="enq-row cl-row" href={`/plan/${row.id}`} target="_blank" rel="noreferrer" data-row-key={row.key}
        aria-label={rowLabel(row)}>
        {body}
      </a>
    );
  }
  if (row.kind === "account" && row.ref === null) {
    return <div className="enq-row cl-row cl-row--still" aria-label={rowLabel(row)} role="group">{body}</div>;
  }
  return (
    <button type="button" className="enq-row cl-row" data-row-key={row.key} aria-label={rowLabel(row)}
      aria-current={open ? "true" : undefined} onClick={() => { onActivate(row); }}>
      {body}
    </button>
  );
}
