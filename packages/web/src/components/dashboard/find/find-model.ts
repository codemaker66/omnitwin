import type { SearchResults } from "../../../api/clients.js";
import { parseGoToDate } from "../../../pages/diary/lib/go-to-date.js";
import { clientRefToSearchValue, groupResults, rowLabel, type ResultRow } from "../clients/clients-desk-format.js";
import { eventDateLong, eventDateParts } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// Find (T-635, roadmap Tier A #8): one keystroke to any record while the client
// is on the phone. What a typed name, date or page finds, in the order shown,
// and where each finding opens. Pure, so every rule here is tested directly.
//
// Every row opens something this person may open. Pages come from the
// header's own list and gates; the client search is offered only where the
// header offers Clients (the API's own gate, routes/clients.ts); a date only
// where it offers the Diary. See docs/design/find-anything-2026-10-07.
// ---------------------------------------------------------------------------

/** A page the header offers this person, in the header's order. */
export interface FindPlace {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export type FindTarget =
  | { readonly kind: "href"; readonly href: string; readonly newTab: boolean }
  /** A finding the page itself holds (the Diary's board), handed back to it. */
  | { readonly kind: "local"; readonly id: string };

export type FindGroupKey = "date" | "board" | "pages" | "people" | "organisations" | "deals" | "proposals" | "layouts" | "search";

export interface FindRow {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  /** What the row is read out as. */
  readonly label: string;
  readonly target: FindTarget;
  /** A date's answer, room by room, shown in the row itself. */
  readonly answer?: readonly { readonly room: string; readonly text: string }[];
}

/** A day in the Diary, room by room, in its own words (pages/diary/lib/day-answer.ts). */
export interface FindDayAnswer {
  readonly iso: string;
  readonly rooms: readonly { readonly name: string; readonly lines: readonly string[] }[];
}

export interface FindGroup {
  readonly key: FindGroupKey;
  /** The group's heading, or null for the closing search row. */
  readonly label: string | null;
  readonly rows: readonly FindRow[];
}

/** A finding a page holds in memory, offered under the page's own heading. */
export interface FindLocalRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  /** "Booking", "Room": said with the title. */
  readonly kind: string;
}

/** What a page adds to Find while it is showing. The object must keep its
 *  identity across the page's renders; `find` reads the page's latest state,
 *  and `subscribe` says when that state has changed, so an open Find shows
 *  what the page holds now (a board that was still loading, a live change). */
export interface FindSource {
  readonly label: string;
  readonly find: (query: string) => readonly FindLocalRow[];
  readonly pick: (id: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** The client search as Find holds it: only an answer to the query now shown counts. */
export type FindClients =
  | { readonly status: "loading"; readonly query: string }
  | { readonly status: "ready"; readonly query: string; readonly results: SearchResults }
  | { readonly status: "error"; readonly query: string };

/** Five of a kind; the search row opens the rest on the Clients desk. */
export const FIND_GROUP_LIMIT = 5;
/** The API's own bounds on a client search (routes/clients.ts SearchQuery). */
export const FIND_SEARCH_MIN = 2;
export const FIND_SEARCH_MAX = 200;
/** A team's word for a page counts from three letters: one letter finds pages by name. */
const PLACE_WORD_MIN = 3;

/**
 * The words a venue team uses for each page, besides its name (roadmap B3 asks
 * Blake for the team's own; these are a first list). A word may name only what
 * the page really holds.
 */
const PLACE_WORDS: Readonly<Record<string, readonly string[]>> = {
  plan: ["planner", "floor plan", "layout", "room planner"],
  diary: ["calendar", "availability", "holds", "bookings", "provisional", "dates"],
  hallkeeper: ["today", "day board", "event day", "function sheet", "setup sheet", "setup", "set-up"],
  enquiries: ["inbox", "leads", "new enquiries"],
  pipeline: ["deals", "opportunities", "sales", "crm"],
  reviews: ["layout sign-off", "sign-off", "approvals"],
  analytics: ["reports", "figures", "performance", "numbers"],
  proposals: ["quotes", "quotations"],
  search: ["contacts", "people", "organisations", "client search"],
  loadouts: ["standard set-ups", "set-ups"],
  settings: ["changeovers", "turnarounds", "venue name", "address"],
  inventory: ["stock", "furniture", "equipment", "reservations"],
  rota: ["shifts", "staff", "crew", "who is on"],
  onboarding: ["access", "invitations", "accounts"],
  admin: ["platform"],
  capture: ["capture factory", "scans"],
};

/** What a page is for, said beside its name. */
const PLACE_NOTES: Readonly<Record<string, string>> = {
  plan: "Draw a layout in the room",
  diary: "Holds and bookings, room by room",
  hallkeeper: "Today's rooms and setup sheets",
  enquiries: "New and open enquiries",
  pipeline: "Deals by their next step",
  reviews: "Layouts waiting for sign-off",
  analytics: "The venue's figures",
  proposals: "Proposals and their versions",
  search: "People, organisations and their history",
  loadouts: "Standard set-ups for each room",
  settings: "Name, address and changeover times",
  inventory: "Stock, reservations and requests",
  rota: "Shifts and who is on",
  onboarding: "Venues, people and access",
  admin: "Platform administration",
  capture: "Room capture intake",
};

/** Trimmed, with runs of spaces folded, so what is searched is what was meant. */
export function normaliseQuery(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
}

/** How well a page answers the words: its name first, then a word of its
 *  name, then a word the team uses for it; 0 when it does not. */
function placeScore(place: FindPlace, needle: string): number {
  const label = place.label.toLowerCase();
  if (label.startsWith(needle)) return 4;
  if (!needle.includes(" ") && words(label).some((word) => word.startsWith(needle))) return 3;
  if (needle.length < PLACE_WORD_MIN) return 0;
  const spoken = PLACE_WORDS[place.id] ?? [];
  if (spoken.some((word) => word.startsWith(needle))) return 2;
  if (!needle.includes(" ") && spoken.some((word) => words(word).some((part) => part.startsWith(needle)))) return 1;
  return 0;
}

/** The pages that answer the words, best first and otherwise in the header's
 *  order; every page before anything is typed. */
export function matchPlaces(query: string, places: readonly FindPlace[]): readonly FindPlace[] {
  const needle = normaliseQuery(query).toLowerCase();
  if (needle === "") return places;
  return places
    .map((place, index) => ({ place, index, score: placeScore(place, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.place);
}

function offers(places: readonly FindPlace[], id: string): boolean {
  return places.some((place) => place.id === id);
}

/** Whether the words name a date ("14 Nov", "05/06/27", "today"). */
export function namesADate(query: string, today: string): boolean {
  return parseGoToDate(query, today) !== null;
}

/** Whether the words go to the client search: only for someone it answers
 *  (the shell decides: the header offers Clients and the account has its
 *  venue), within the API's bounds, and not for a date, which the Diary
 *  answers and no client is called. */
export function wantsClientSearch(query: string, canSearchClients: boolean, today: string): boolean {
  const length = normaliseQuery(query).length;
  return canSearchClients && length >= FIND_SEARCH_MIN && length <= FIND_SEARCH_MAX && !namesADate(query, today);
}

function dashboardHref(params: Readonly<Record<string, string>>): string {
  return `/dashboard?${new URLSearchParams(params).toString()}`;
}

function searchHref(query: string): string {
  return dashboardHref({ view: "search", q: query });
}

/** The day the words name, for someone who opens the Diary, or null. */
export function soughtDate(query: string, today: string, places: readonly FindPlace[]): string | null {
  return offers(places, "diary") && query !== "" ? parseGoToDate(query, today) : null;
}

function dateGroup(query: string, today: string, places: readonly FindPlace[], answered: FindDayAnswer | null): FindGroup | null {
  const iso = soughtDate(query, today, places);
  if (iso === null) return null;
  // "Saturday 14 November 2026", as the desks write a date.
  const title = eventDateLong(iso) ?? iso;
  const target: FindTarget = { kind: "href", href: `/diary?${new URLSearchParams({ date: iso, goto: iso }).toString()}`, newTab: false };
  // Answered in place once the Diary has been read for that day: the question
  // asked most on the phone, with no page to leave.
  const answer = answered?.iso === iso
    ? answered.rooms.map((room) => ({ room: room.name, text: room.lines.join("; ") }))
    : null;
  if (answer === null || answer.length === 0) {
    const detail = "See each room in the Diary";
    return { key: "date", label: "Date", rows: [{ key: `date:${iso}`, title, detail, label: `${title}, ${detail}`, target }] };
  }
  const detail = "Open this day in the Diary";
  const said = answer.map((room) => `${room.room}, ${room.text}`).join("; ");
  return {
    key: "date", label: "Date",
    rows: [{ key: `date:${iso}`, title, detail, label: `${title}: ${said}. ${detail}`, target, answer }],
  };
}

/** Where a client finding opens: in its own desk, by its address. */
function clientTarget(row: ResultRow, query: string): FindTarget {
  switch (row.kind) {
    case "user":
    case "lead":
    case "contact":
      return { kind: "href", href: dashboardHref({ view: "search", q: query, client: clientRefToSearchValue(row.ref) }), newTab: false };
    case "account":
    case "enquiry":
      return row.ref === null
        ? { kind: "href", href: searchHref(query), newTab: false }
        : { kind: "href", href: dashboardHref({ view: "search", q: query, client: clientRefToSearchValue(row.ref) }), newTab: false };
    case "deal":
      return { kind: "href", href: dashboardHref({ view: "pipeline", opportunity: row.id }), newTab: false };
    case "proposal":
      return { kind: "href", href: dashboardHref({ view: "proposals", proposal: row.id }), newTab: false };
    case "layout":
      return { kind: "href", href: `/plan/${row.id}`, newTab: true };
  }
}

/** A row's detail as Find shows it: a deal leads with its date, which the
 *  Clients desk shows as a tile and Find has no room for. */
function findDetail(row: ResultRow): string {
  if (row.kind !== "deal") return row.detail;
  const date = eventDateParts(row.date)?.full ?? "Date TBC";
  return row.detail === "" ? date : `${date} · ${row.detail}`;
}

const CLIENT_GROUP_KEYS: Readonly<Record<string, FindGroupKey>> = {
  people: "people", organisations: "organisations", deals: "deals", proposals: "proposals", layouts: "layouts",
};

function clientGroups(clients: FindClients | null, query: string): FindGroup[] {
  if (clients === null || clients.status !== "ready" || clients.query !== query) return [];
  return groupResults(clients.results).flatMap((group) => {
    const key = CLIENT_GROUP_KEYS[group.key];
    if (key === undefined) return [];
    return [{
      key, label: group.label,
      rows: group.rows.slice(0, FIND_GROUP_LIMIT).map((row) => ({
        key: row.key, title: row.title, detail: findDetail(row), label: rowLabel(row), target: clientTarget(row, query),
      })),
    }];
  });
}

export interface FindInput {
  /** Already normalised (normaliseQuery). */
  readonly query: string;
  /** The venue's own date, "YYYY-MM-DD". */
  readonly today: string;
  readonly places: readonly FindPlace[];
  /** What the page showing found, under its heading, or null. */
  readonly board: { readonly label: string; readonly rows: readonly FindLocalRow[] } | null;
  /** Whether the client search answers this person (wantsClientSearch). */
  readonly canSearchClients: boolean;
  readonly clients: FindClients | null;
  /** The sought day as the Diary has it, once read; absent or null until then. */
  readonly dayAnswer?: FindDayAnswer | null;
}

/** Everything Find shows for the words, in order: a date, the page's own
 *  findings, pages, then clients and the row that searches for them. */
export function buildFindGroups(input: FindInput): FindGroup[] {
  const { query, today, places, board, canSearchClients, clients } = input;
  const groups: FindGroup[] = [];
  const date = dateGroup(query, today, places, input.dayAnswer ?? null);
  if (date !== null) groups.push(date);
  if (board !== null && board.rows.length > 0) {
    groups.push({
      key: "board", label: board.label,
      rows: board.rows.map((row) => ({
        key: `board:${row.id}`, title: row.title, detail: row.detail,
        label: [row.title, row.kind.toLowerCase(), row.detail].filter((part) => part !== "").join(", "),
        target: { kind: "local", id: row.id },
      })),
    });
  }
  const pages = matchPlaces(query, places);
  if (pages.length > 0) {
    groups.push({
      key: "pages", label: "Pages",
      rows: pages.map((place) => {
        const detail = PLACE_NOTES[place.id] ?? "";
        return {
          key: `page:${place.id}`, title: place.label, detail,
          label: [place.label, "page", detail].filter((part) => part !== "").join(", "),
          target: { kind: "href", href: place.href, newTab: false },
        };
      }),
    });
  }
  if (wantsClientSearch(query, canSearchClients, today)) {
    groups.push(...clientGroups(clients, query));
    const title = `Search clients for “${query}”`;
    const detail = "See everything found on the Clients desk";
    groups.push({
      key: "search", label: null,
      rows: [{ key: "search", title, detail, label: `${title}, ${detail}`, target: { kind: "href", href: searchHref(query), newTab: false } }],
    });
  }
  return groups;
}

export function rowsOf(groups: readonly FindGroup[]): readonly FindRow[] {
  return groups.flatMap((group) => group.rows);
}

/** The row Enter opens: the first, so the best finding is ready as it
 *  arrives, until the person moves to another with the arrows or the
 *  pointer; then that one for as long as it is listed, so findings arriving
 *  later never move a row the person chose. */
export function activeKeyAfter(rows: readonly FindRow[], previous: string | null, moved: boolean): string | null {
  if (moved && previous !== null && rows.some((row) => row.key === previous)) return previous;
  return rows[0]?.key ?? null;
}

function sentence(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** What this person's Find covers, and nothing it does not. */
export function findScope(places: readonly FindPlace[], hasBoard: boolean, canSearchClients: boolean): string {
  const parts: string[] = [];
  if (offers(places, "diary")) parts.push("dates");
  parts.push("pages");
  if (hasBoard) parts.push("what the board has read");
  const clients = canSearchClients;
  if (clients) {
    parts.push("people");
    if (offers(places, "pipeline")) parts.push("organisations", "deals", "proposals");
    parts.push("layouts");
  }
  const said = sentence(parts);
  const capitalised = said.charAt(0).toUpperCase() + said.slice(1);
  return clients ? `${capitalised}, by a near spelling too.` : `${capitalised}.`;
}
