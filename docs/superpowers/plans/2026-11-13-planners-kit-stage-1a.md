# The planner's kit, stage 1a: the guest list and the paper, on the planner's own device

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A planner opens a page beside their plan, pastes a list of names, seats them at tables from a list, and
prints a table plan, place cards and covers by table, with every name kept only in their own browser.

**Architecture:** Web only (`packages/web`). Pure functions in `src/lib/guest-list/` hold the model, the paste
reader, the seating and the paper; a small store keeps one list per plan in IndexedDB; two lazy pages show the
desk and the paper. Nothing is sent to the server: no API route, no table, no sign-up. The plan in the room is
only read, once, to count its tables.

**Tech stack:** React 18, react-router-dom 7, Zustand, Zod 4, Vitest (happy-dom), Playwright, plain CSS on the
house tokens. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-13-planners-kit-design.md` (approved by Blake on 13 November 2026). This
plan builds its stage 1 as far as "works on the planner's own device with no account" (sections 5.2, 5.4, 5.5,
5.7 and 5.8). Accounts, links, an own room and the venue's page are later plans.

## Global Constraints

- **No name leaves the device.** No request carries a guest's name, party, table or seat. The only request these
  pages make is the existing read of the plan, `getPublicConfig(planId, signal)`.
- **A guest is a name, a party, a table and a seat. Nothing else.** No email, telephone, notes, diet or access
  field, on screen or in storage. Every other pasted column is dropped in the browser and the page says so.
- Limits, exact: a name at most **80** characters; a party at most **60**; at most **600** guests a list; at
  most **80** tables; seats at a table **1 to 24**, default **10**.
- **Keeping times on the device:** a list is removed 30 days after its event date, or 90 days after its last
  change when no date is set. The page says which applies.
- **Seating is from the list, never drawn in the room.** A guest is bound to the kit's own table record. A seat
  is a number round that table. When a table goes, its guests go back to "to seat", visibly, with a count.
- **The plan in the room is read, never written.** No name is put on the canvas or into a placed piece.
- **Paper:** the table plan is lists only (A to Z, and by table), never a drawing. Every sheet carries its
  version and date. Guests with no seat are not on the table plan, and the page says how many.
- **No guest's name in an error message, a thrown value, a class name, a log line, an address or a tag.** Errors
  carry fixed words or codes only. (Error reports keep exception text and class names.)
- **Behind a switch:** the pages answer only when `?kit=on` has been given on this device; otherwise they are
  the not-found page. The first users are five invited planners.
- **House rules:** TypeScript strict, no `any`; Zod on everything read from storage or pasted; every working
  state uses `ActivityStatus` from `components/shared/Activity.tsx`; colours and type from the house tokens
  through `data-register`; no type under 14 px for names and facts; no praise or cheerleading copy; British
  plain words; hover never moves the hovered element; nothing interrupts typing.
- **The step budget (the spec's "done when"):** from opening the page to the print dialog in no more than 10
  clicks and 3 typed fields, with one paste.
- **Spare the PC:** heavy local runs (`tsc`, builds, multi-file vitest, installs, Playwright) go through
  the machine's queue for heavy checks, one at a time.
- `packages/web/src/router.tsx` has CRLF line endings; keep them.

## Review Focus

Inputs the spec implies and a person will meet. Each has a test in the task that owns the code.

1. **A pasted list that is not one clean column:** "Surname, First" with a comma, quoted cells holding commas,
   a header row, blank lines. Nobody may be dropped or split silently; the count shown before "Add" is the count
   added. (Task 2)
2. **Storage that is missing, blocked or emptied** (a private window, cleared site data). The page still works,
   says plainly that the list is not being kept, and never shows a blank screen. (Tasks 5 and 9)
3. **The same list open in two tabs.** A newer saved copy must not be overwritten unseen; the page says when it
   kept this tab's version. (Task 5)
4. **The plan has changed or gone** (claimed at sign-up, or deleted after 72 hours unsaved). The list survives,
   and the page says the room could not be checked or that the table counts differ. (Tasks 6 and 9)
5. **Names that are long, odd or look like formulas:** 500 characters, emoji, right-to-left text, a leading
   `=`. Refused over 80 with a count, shown as text, and made harmless in the downloaded file. (Tasks 2 and 4)

---

## File structure

All under `packages/web/`.

| File | Responsibility |
|---|---|
| `src/lib/guest-list/model.ts` | The shapes, the limits, and `repairGuestList` |
| `src/lib/guest-list/parse-paste.ts` | Reading pasted text into rows; taking names and parties |
| `src/lib/guest-list/seating.ts` | Tables, seats, "seat everyone", moves, the counts |
| `src/lib/guest-list/paper.ts` | The table plan A to Z, by table, covers, place cards |
| `src/lib/guest-list/export.ts` | The downloadable list as text |
| `src/lib/guest-list/store.ts` | One list per plan in IndexedDB; sweep; erase; two tabs |
| `src/lib/guest-list/plan-tables.ts` | Counting the plan's dining tables and their chairs |
| `src/lib/guest-list/kit-switch.ts` | The `?kit=on` switch |
| `src/stores/guest-list-store.ts` | Page state: the open list, autosave, undo |
| `src/components/guest-list/*.tsx` | `GuestPaste`, `GuestTables`, `GuestRows`, `GuestPanel` |
| `src/pages/GuestListPage.tsx` + `.css` | The desk: sheet, copper plane, ledger, forest panel |
| `src/pages/GuestPaperPage.tsx` + `.css` | The four sheets and the print rules |
| `src/router.tsx`, `vercel.json` | Two routes and their four rewrites |
| `e2e/guest-list-journey.spec.ts` | The journey, counted; print; nothing sent |

Tests sit in `__tests__/` beside the code.

---

### Task 1: The model and its invariants

**Files:**
- Create: `src/lib/guest-list/model.ts`
- Test: `src/lib/guest-list/__tests__/model.test.ts`

**Interfaces:**
- Produces:

```ts
export const GUEST_NAME_MAX = 80, PARTY_MAX = 60, GUESTS_MAX = 600, TABLES_MAX = 80;
export const SEATS_MIN = 1, SEATS_MAX = 24, SEATS_DEFAULT = 10, LIST_VERSION = 1;
export const KEEP_DAYS_AFTER_EVENT = 30, KEEP_DAYS_AFTER_CHANGE = 90;
export const GuestSchema;      // { id: uuid, name: 1..80, party: 0..60, tableId: uuid | null, seat: int 1..24 | null }
export const KitTableSchema;   // { id: uuid, number: int 1..999, name: 0..60, seats: int 1..24 }
export const GuestListSchema;  // { version: 1, planId: uuid, title: 0..120, eventDate: "YYYY-MM-DD" | null,
                               //   sortBy: "last-word" | "first-word", guests: Guest[] (<=600), tables: KitTable[] (<=80),
                               //   paperVersion: int >= 0, changedSincePrint: boolean, printedAt: ISO string | null,
                               //   updatedAt: ISO string }
export type Guest, KitTable, GuestList;
export function emptyGuestList(planId: string, nowIso: string): GuestList;
export function repairGuestList(list: GuestList): { readonly list: GuestList; readonly unseated: number };
export function deleteAfter(list: GuestList): { readonly dateIso: string; readonly rule: "event" | "change" };
```

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a guest record with any other field", () => {
  expect(GuestSchema.safeParse({ ...guest, email: "x" }).success).toBe(false);   // strict object
});
it("refuses a name over 80 characters and an empty name", () => {
  expect(GuestSchema.safeParse({ ...guest, name: "a".repeat(81) }).success).toBe(false);
  expect(GuestSchema.safeParse({ ...guest, name: "" }).success).toBe(false);
});
it("repair unseats, and counts, a guest whose table is gone, whose seat is taken twice, or beyond the table's seats", () => {
  const { list, unseated } = repairGuestList(broken);   // three bad guests among ten
  expect(unseated).toBe(3);
  expect(list.guests.filter((g) => g.tableId === null).length).toBe(3);
  expect(list.guests.every((g) => g.tableId !== null || g.seat === null)).toBe(true);
});
it("deletes 30 days after the event, or 90 days after the last change with no date", () => {
  expect(deleteAfter({ ...list, eventDate: "2027-06-12" })).toEqual({ dateIso: "2027-07-12", rule: "event" });
  expect(deleteAfter({ ...list, eventDate: null, updatedAt: "2026-11-13T10:00:00.000Z" }).dateIso).toBe("2027-02-11");
});
```

- [ ] **Step 2: Run** `pnpm -F @omnitwin/web exec vitest run src/lib/guest-list/__tests__/model.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `model.ts`.** Schemas are `z.strictObject`. When two guests hold one seat, `repairGuestList` keeps the first in list order. It never reorders guests.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `git add packages/web/src/lib/guest-list && git commit -m "feat(kit): the guest list model and its invariants"`

### Task 2: Reading a pasted list

**Files:**
- Create: `src/lib/guest-list/parse-paste.ts`
- Test: `src/lib/guest-list/__tests__/parse-paste.test.ts`

**Interfaces:**
- Consumes: `GUEST_NAME_MAX`, `PARTY_MAX`, `GUESTS_MAX` from Task 1.
- Produces:

```ts
export interface ParsedPaste {
  readonly rows: readonly (readonly string[])[];   // header row removed
  readonly columnCount: number;
  readonly hadHeader: boolean;
  readonly nameColumn: number;                      // the reader's guess
  readonly secondNameColumn: number | null;         // e.g. a separate surname column
  readonly partyColumn: number | null;
}
export function parsePaste(text: string, opts?: { readonly header?: boolean }): ParsedPaste;
export interface Taken {
  readonly guests: readonly { readonly name: string; readonly party: string }[];
  readonly droppedColumns: number;
  readonly skipped: { readonly blank: number; readonly tooLong: number; readonly overLimit: number };
}
export function takeNames(parsed: ParsedPaste, pick: { readonly nameColumn: number; readonly secondNameColumn: number | null;
  readonly secondFirst: boolean; readonly partyColumn: number | null }, roomLeft: number): Taken;
```

- [ ] **Step 1: Write the failing tests** (Review Focus 1 and 5 live here)

```ts
it("reads a spreadsheet paste (tabs) and guesses the columns from the header", () => {
  const p = parsePaste("First name\tSurname\tHousehold\tDiet\nAilsa\tFraser\tFraser\tvegetarian\nChidi\tOkafor\tOkafor\t");
  expect([p.hadHeader, p.columnCount, p.nameColumn, p.secondNameColumn, p.partyColumn]).toEqual([true, 4, 0, 1, 2]);
});
it("keeps a quoted cell with a comma whole", () => {
  expect(parsePaste('"Fraser, Ailsa",Top table\n"Okafor, Chidi",Top table').rows[0]).toEqual(["Fraser, Ailsa", "Top table"]);
});
it("reads one name a line, blank lines and stray spaces and all", () => {
  expect(parsePaste("  Ailsa   Fraser \n\nChidi Okafor\n").rows).toEqual([["Ailsa Fraser"], ["Chidi Okafor"]]);
});
it("takes names and parties only, and says what it left", () => {
  const t = takeNames(parsePaste(SHEET_4_COLUMNS_180_ROWS), { nameColumn: 0, secondNameColumn: 1, secondFirst: false, partyColumn: 2 }, 600);
  expect(t.guests.length).toBe(180);
  expect(t.guests[0]).toEqual({ name: "Ailsa Fraser", party: "Fraser" });
  expect(t.droppedColumns).toBe(1);
});
it("refuses, and counts, a name over 80 characters and rows beyond the room left", () => {
  const t = takeNames(parsePaste(["a".repeat(500), "Ok One", "Ok Two", "Ok Three"].join("\n")), ONE_COLUMN, 2);
  expect(t.guests.map((g) => g.name)).toEqual(["Ok One", "Ok Two"]);
  expect(t.skipped).toEqual({ blank: 0, tooLong: 1, overLimit: 1 });
});
it("keeps emoji, right-to-left text and a leading equals sign as plain text", () => {
  const t = takeNames(parsePaste("=SUM(A1)\n\u05d3\u05e0\u05d9\u05d0\u05dc \u05db\u05d4\u05df\nZo\u00eb \ud83c\udf89"), ONE_COLUMN, 600);
  expect(t.guests.map((g) => g.name)).toEqual(["=SUM(A1)", "\u05d3\u05e0\u05d9\u05d0\u05dc \u05db\u05d4\u05df", "Zo\u00eb \ud83c\udf89"]);
});
it("takes 5,000 rows without throwing and stops at the room left", () => {
  expect(takeNames(parsePaste(FIVE_THOUSAND_NAMES), ONE_COLUMN, 600).skipped.overLimit).toBe(4400);
});
```

- [ ] **Step 2: Run the test file.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Rules the tests do not fully pin:
  - Any tab in the text means tab-separated. Otherwise it is comma-separated only if every non-blank line has the same number (one or more) of commas outside quotes; otherwise one name a line.
  - A first row is a header when any of its cleaned cells is one of the usual headings, case-insensitive: a name heading (an optional `guest`, `first`, `given`, `last`, `sur`, `family` or `full` before `name`, with an optional plural: `name`, `names`, `name(s)`, `guest name`, `given name`, `family name`, `surname`, `last name`, `full names`); `guest`, `guests`, `household`, `party`, `group`, `family`, `party/household`; or a heading only a header row carries (`table`, `table no`, `table number`, `seat`, `rsvp`, `email`, `phone`, `diet`, `dietary`, `dietary requirements`, `notes`, `title`). The caller may overrule the test with `opts.header` (true: the first row is the header; false: it is a guest row). Guesses use the same headings: name = the first name-ish heading or `guest(s)` (a surname heading only when there is no other); second name = a `sur`/`last`/`family name` heading; party = `household`, `party`, `group`, `family`, `party/household`.
  - A cell-start quote opens a quoted cell only when a later quote is followed by the delimiter, a line end or the end of the text ("" is one quote). A quote followed by anything else (`"Granny" Fraser`) means the opening quote is plain text.
  - Clean each cell: Unicode NFC, control characters removed, runs of whitespace to one space, trimmed. Length is counted in characters (code points), not UTF-16 units.
  - Two name columns join as "first second" (or the reverse when `secondFirst`).
  - No function here throws with the pasted text in its message.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): read a pasted guest list, names and parties only`

### Task 3: Tables, seats and "seat everyone"

**Files:**
- Create: `src/lib/guest-list/seating.ts`
- Test: `src/lib/guest-list/__tests__/seating.test.ts`

**Interfaces:**
- Consumes: Task 1's types and limits.
- Produces (every function returns a new list and sets `changedSincePrint: true`; none mutates):

```ts
export function addGuests(list: GuestList, taken: readonly { name: string; party: string }[], ids: readonly string[]): GuestList;
export function removeGuest(list: GuestList, guestId: string): GuestList;
export function renameGuest(list: GuestList, guestId: string, name: string, party: string): GuestList | { readonly refused: "name" };
export function setTables(list: GuestList, count: number, seats: number, ids: readonly string[]): GuestList;
export function setTableSeats(list: GuestList, tableId: string, seats: number): GuestList;
export function nameTable(list: GuestList, tableId: string, name: string): GuestList;
export function removeTable(list: GuestList, tableId: string): GuestList;
export function seatEveryone(list: GuestList): GuestList;
export type MoveRefusal = { readonly refused: "seat-taken" | "table-full" | "no-such-table" | "no-such-guest" };
export function moveGuest(list: GuestList, guestId: string, tableId: string | null, seat?: number): GuestList | MoveRefusal;
export function summary(list: GuestList): { readonly guests: number; readonly seated: number; readonly toSeat: number;
  readonly tables: number; readonly freeSeats: number };
```

- [ ] **Step 1: Write the failing tests**

```ts
it("seats 180 guests at 18 tables of 10 in list order", () => {
  const seated = seatEveryone(setTables(list180, 18, 10, ids));
  expect(summary(seated)).toEqual({ guests: 180, seated: 180, toSeat: 0, tables: 18, freeSeats: 0 });
  expect(seated.guests[0]).toMatchObject({ tableId: seated.tables[0]?.id, seat: 1 });
  expect(seated.guests[10]).toMatchObject({ tableId: seated.tables[1]?.id, seat: 1 });
});
it("keeps a party together: a party of 4 does not start in the last 2 seats of a table", () => {
  // 8 singles, then a party of 4, tables of 10: the party sits together at table 2
  const s = seatEveryone(setTables(eightThenPartyOfFour, 2, 10, ids));
  const party = s.guests.filter((g) => g.party === "Okafor");
  expect(new Set(party.map((g) => g.tableId)).size).toBe(1);
  expect(party[0]?.tableId).toBe(s.tables[1]?.id);
});
it("splits a party only when it is larger than any table, in order", () => { /* party of 12, tables of 10 */ });
it("leaves a seated guest where they are, and fills only free seats", () => { /* seat one by hand, then seatEveryone */ });
it("with too few seats, seats what fits and leaves the rest to seat", () => {
  expect(summary(seatEveryone(setTables(list180, 17, 10, ids)))).toMatchObject({ seated: 170, toSeat: 10 });
});
it("refuses a taken seat and a full table, and changes nothing", () => {
  expect(moveGuest(seated, a.id, t1.id, 1)).toEqual({ refused: "seat-taken" });
  expect(moveGuest(seated, unseatedGuest.id, fullTable.id)).toEqual({ refused: "table-full" });
});
it("removing a table, or lowering its seats, sends its guests back to seat", () => {
  expect(summary(removeTable(seated, seated.tables[17]!.id)).toSeat).toBe(10);
  expect(summary(setTableSeats(seated, seated.tables[0]!.id, 8)).toSeat).toBe(2);
});
it("setTables takes away the last tables first and never renumbers the rest", () => { /* 18 -> 16: numbers 1..16 stay */ });
```

- [ ] **Step 2: Run the test file.** Expected: FAIL.
- [ ] **Step 3: Implement.** `seatEveryone` works table by table in number order. A party is every unseated guest sharing a non-empty party label (compared trimmed, case-insensitive), taken at its first member's place in the list. A party's unseated members first join a table where the party already sits, if it has room for all of them (the lowest-numbered such table). Otherwise a whole party goes to the first table with room for all of it; guests with no party go one at a time. A new table's number is the highest number plus one. `moveGuest` with no `seat` takes the lowest free seat.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): tables, seats and seat everyone`

### Task 4: The paper, and the downloadable list

**Files:**
- Create: `src/lib/guest-list/paper.ts`, `src/lib/guest-list/export.ts`
- Test: `src/lib/guest-list/__tests__/paper.test.ts`, `src/lib/guest-list/__tests__/export.test.ts`

**Interfaces:**
- Produces:

```ts
export type Sheet = "table-plan" | "by-table" | "place-cards" | "covers";
export function sortKey(name: string, sortBy: "last-word" | "first-word"): string;
export function planLabel(name: string, sortBy: "last-word" | "first-word"): string;   // "Fraser, Ailsa" or as written
export function tablePlanAZ(list: GuestList): { readonly groups: readonly { readonly letter: string;
  readonly entries: readonly { readonly label: string; readonly table: number }[] }[]; readonly notSeated: number };
export function byTable(list: GuestList): readonly { readonly number: number; readonly name: string;
  readonly seats: number; readonly guests: readonly { readonly seat: number; readonly name: string }[] }[];
export function covers(list: GuestList): { readonly tables: readonly { readonly number: number; readonly covers: number }[]; readonly total: number };
export function placeCards(list: GuestList): readonly { readonly name: string; readonly table: number }[];
export function markPrinted(list: GuestList, nowIso: string): GuestList;   // printedAt = nowIso always; paperVersion + 1 if changedSincePrint
                                                                           // or paperVersion is 0 (a first print is version 1); then
                                                                           // changedSincePrint = false; updatedAt untouched
export function toCsv(list: GuestList): string;                             // name, party, table, seat
```

- [ ] **Step 1: Write the failing tests**

```ts
it("puts only seated guests on the table plan and counts the rest", () => {
  const plan = tablePlanAZ(list172of180);
  expect(plan.notSeated).toBe(8);
  expect(plan.groups.flatMap((g) => g.entries).length).toBe(172);
});
it("sorts by the last word and writes it first; sorts as written when asked", () => {
  expect(planLabel("Ailsa Jean Fraser", "last-word")).toBe("Fraser, Ailsa Jean");
  expect(planLabel("Mr and Mrs Fraser", "first-word")).toBe("Mr and Mrs Fraser");
  expect(tablePlanAZ(three).groups.map((g) => g.letter)).toEqual(["F", "M", "O"]);
});
it("orders accents and case as a reader expects", () => { /* "\u00c9ireann", "eze", "Zo\u00eb" via localeCompare("en-GB") */ });
it("covers add up to the seated count, table by table", () => {
  expect(covers(list172of180)).toMatchObject({ total: 172 });
  expect(covers(list172of180).tables[16]).toEqual({ number: 17, covers: 6 });
});
it("a first print is version 1; printing again unchanged keeps the version", () => {
  const once = markPrinted(changed, NOW);
  expect([once.paperVersion, once.changedSincePrint]).toEqual([1, false]);
  expect(markPrinted(once, NOW).paperVersion).toBe(1);
});
it("the downloaded list cannot run as a formula", () => {
  expect(toCsv(withGuestNamed("=SUM(A1)"))).toContain("\"'=SUM(A1)\"");   // also for + - @ and tab
});
```

- [ ] **Step 2: Run both test files.** Expected: FAIL.
- [ ] **Step 3: Implement.** Letters are the upper-cased first letter of the sort key with accents folded for grouping only (the label keeps its accents); a key that does not start with a letter groups under `#`. `toCsv` quotes every cell, doubles quotes, ends lines with `\r\n`, and starts with a UTF-8 byte order mark so a spreadsheet opens it correctly.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): table plan, covers, place cards and the downloadable list`

### Task 5: Keeping the list on the device

**Files:**
- Create: `src/lib/guest-list/store.ts`
- Test: `src/lib/guest-list/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `openCache`, `withBackend`, `memoryBackend`, `CacheHandle` from `src/lib/idb-cache.ts`; Task 1.
- Produces:

```ts
export const GUEST_LIST_DB = "venviewer-guest-lists", GUEST_LIST_STORE = "lists";
export type Opened =
  | { readonly kind: "ready"; readonly list: GuestList; readonly repaired: number }
  | { readonly kind: "new" }
  | { readonly kind: "unreadable" }          // something is stored for this plan but it is not a valid list
  | { readonly kind: "not-kept" };           // storage refused; work in memory only
export type Saved = "saved" | "not-kept" | "newer-copy-kept-ours";
export interface GuestListStore {
  open(planId: string): Promise<Opened>;
  save(list: GuestList, loadedUpdatedAt: string | null): Promise<Saved>;
  erase(planId: string): Promise<void>;
  sweep(nowMs: number): Promise<number>;     // removes lists past deleteAfter(); returns how many
}
export function createGuestListStore(handle: CacheHandle<unknown>): GuestListStore;
export function guestListStore(): GuestListStore;   // the lazily made device store
```

- [ ] **Step 1: Write the failing tests** (Review Focus 2 and 3 live here)

```ts
const store = () => createGuestListStore(withBackend<unknown>(memoryBackend()));
it("opens what it saved, keyed by plan", async () => { /* save A and B, open A */ });
it("says not-kept, and does not throw, when storage refuses", async () => {
  const s = createGuestListStore(withBackend<unknown>(refusingBackend()));   // every method rejects
  expect(await s.open(PLAN)).toEqual({ kind: "not-kept" });
  expect(await s.save(list, null)).toBe("not-kept");
});
it("says unreadable for a stored value that is not a list, and leaves it in place", async () => { /* put {junk:true} */ });
it("repairs on open and reports how many it unseated", async () => { /* stored list with a double-booked seat */ });
it("a second tab's newer copy is not overwritten unseen", async () => {
  // tab A and tab B open the same list; B saves; A then saves with A's loadedUpdatedAt
  expect(await a.save(aChanged, aLoadedAt)).toBe("newer-copy-kept-ours");
});
it("sweeps a list 30 days after its event and 90 days after its last change, and nothing sooner", async () => {
  expect(await s.sweep(Date.parse("2027-07-13T00:00:00Z"))).toBe(1);
});
it("erase removes the list and only that list", async () => { /* ... */ });
it("no error it raises or returns holds a guest's name", async () => { /* canary name "CANARY-Q7"; collect thrown and returned text */ });
```

- [ ] **Step 2: Run the test file.** Expected: FAIL.
- [ ] **Step 3: Implement.** The key is the plan id. Every handle call is inside `try`/`catch`; a rejection becomes `not-kept`. `open` validates with `GuestListSchema.safeParse`, then `repairGuestList`. `save` re-reads the stored copy first: if its `updatedAt` is later than `loadedUpdatedAt`, save anyway and return `newer-copy-kept-ours`. Follow the module-level cached handle pattern of `src/lib/event-day-offline-queue.ts:111-120` for `guestListStore()`.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): keep the guest list on the planner's own device`

### Task 6: Counting the plan's tables

**Files:**
- Create: `src/lib/guest-list/plan-tables.ts`
- Test: `src/lib/guest-list/__tests__/plan-tables.test.ts`

**Interfaces:**
- Consumes: `PlacedObject` from `src/api/configurations.ts`; `getCatalogueItem` from `src/lib/catalogue.ts`; `isDiningTableItem` from `src/lib/furniture-semantics.ts`; `seatsFor` from `@omnitwin/types`.
- Produces:

```ts
export interface PlanTables { readonly tables: number; readonly seatsEach: readonly number[] }   // one figure a table
export function planTables(objects: readonly PlacedObject[]): PlanTables;
export function tablesDiffer(plan: PlanTables, list: GuestList): { readonly room: number; readonly list: number } | null;
```

- [ ] **Step 1: Write the failing tests** (Review Focus 4 starts here)

```ts
it("counts dining tables only: no chairs, no stage, no service table", () => { expect(planTables(grandHallDinner).tables).toBe(18); });
it("a table's seats are the chairs grouped with it, or its usual number when it has none", () => {
  expect(planTables(tableWithEightGroupedChairs).seatsEach).toEqual([8]);
  expect(planTables(roundTableAlone).seatsEach).toEqual([10]);
});
it("an unknown piece is ignored, not an error", () => { expect(planTables([pieceWithUnknownAsset]).tables).toBe(0); });
it("says nothing when the counts agree, and both numbers when they do not", () => {
  expect(tablesDiffer({ tables: 18, seatsEach: [] }, list18)).toBeNull();
  expect(tablesDiffer({ tables: 17, seatsEach: [] }, list18)).toEqual({ room: 17, list: 18 });
});
```

- [ ] **Step 2: Run the test file.** Expected: FAIL.
- [ ] **Step 3: Implement.** A chair belongs to a table when both carry the same non-empty `metadata.groupId` and the chair's catalogue category is `"chair"`. "Usual number" is `seatsFor(item)?.default ?? SEATS_DEFAULT`, capped to 1..24.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): count the plan's tables for the guest list`

### Task 7: The page's state

**Files:**
- Create: `src/stores/guest-list-store.ts`
- Test: `src/stores/__tests__/guest-list-store.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 6.
- Produces:

```ts
export type KitPhase = "opening" | "ready" | "unreadable";
export interface GuestListState {
  readonly phase: KitPhase; readonly list: GuestList | null;
  readonly kept: boolean;                    // false when storage refused
  readonly notice: null | { readonly kind: "repaired"; readonly unseated: number } | { readonly kind: "other-tab" };
  readonly canUndo: boolean;
  open(planId: string, store: GuestListStore, nowIso: string): Promise<void>;
  apply(change: (list: GuestList) => GuestList): void;   // records undo, marks dirty, schedules a save
  undo(): void;
  startAgain(): Promise<void>;               // for "unreadable": erase and begin a new list
  eraseList(): Promise<void>;
  flush(): Promise<void>;
}
export const useGuestListStore: UseBoundStore<StoreApi<GuestListState>>;
export const AUTOSAVE_MS = 600, UNDO_STEPS = 30;
```

- [ ] **Step 1: Write the failing tests** with `vi.useFakeTimers()`: a change is saved within 2 seconds (advance 600 ms, expect one `save`); thirty changes then thirty-one undos return to the opened list and `canUndo` is false; `not-kept` from the store sets `kept: false` and keeps the list in memory; `newer-copy-kept-ours` sets the `other-tab` notice; `unreadable` leaves `list: null` until `startAgain()`.
- [ ] **Step 2: Run the test file.** Expected: FAIL.
- [ ] **Step 3: Implement** with `create` from zustand. `apply` sets `updatedAt` from an injected clock. Saves are queued one at a time; `flush` awaits the queue (the pages call it before leaving and before printing).
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): page state with autosave and undo`

### Task 8: The switch and the two routes

**Files:**
- Create: `src/lib/guest-list/kit-switch.ts`, `src/pages/GuestListPage.tsx`, `src/pages/GuestPaperPage.tsx` (shells)
- Modify: `src/router.tsx` (lazy imports beside `:156-161`; route entries beside `:743-748`), `vercel.json` (beside `:565-571`)
- Test: `src/lib/guest-list/__tests__/kit-switch.test.ts`, `src/pages/__tests__/GuestListPage.test.tsx`

**Interfaces:**
- Produces:

```ts
export const KIT_PARAM = "kit", KIT_STORAGE_KEY = "venviewer.planners-kit";
export function kitRequested(search: string): boolean;   // ?kit=on turns it on and is remembered; ?kit=off forgets
// routes: "/plan/:code/guests" -> GuestListPage ; "/plan/:code/guests/paper" -> GuestPaperPage (sheet in ?sheet=)
```

- [ ] **Step 1: Write the failing tests**

```ts
it("is off until asked for, then remembered on this device", () => {
  expect(kitRequested("")).toBe(false);
  expect(kitRequested("?kit=on")).toBe(true);
  expect(kitRequested("")).toBe(true);
  expect(kitRequested("?kit=off")).toBe(false);
});
it("works when storage throws", () => { /* localStorage getter throws: ?kit=on still true, no exception */ });
// GuestListPage.test.tsx (MemoryRouter, as pages/__tests__/PlanViewPage.test.tsx does)
it("is the not-found page with the switch off, and makes no request", () => { /* getPublicConfig mock not called */ });
it("with a malformed plan id, says the address is not a plan and makes no request", () => { /* /plan/not-a-uuid/guests?kit=on */ });
it("sets noindex and no-referrer in the head and removes them on leaving", () => { /* as PlanViewPage's test pins */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Declare both pages with `lazy(() => cockpitImport(() => import("./pages/GuestListPage.js").then((m) => ({ default: m.GuestListPage }))))` and `withSuspense(...)`; no auth wrapper. Add four rewrites to `vercel.json`, each to `/index.html`: `/plan/:code/guests`, `/plan/:code/guests/`, `/plan/:code/guests/paper`, `/plan/:code/guests/paper/`. Each page validates `:code` with `z.uuid()` before anything else, copies `usePrivatePageHead` from `PlanViewPage.tsx:39-53`, and renders `NotFoundPage` when `kitRequested(location.search)` is false.
- [ ] **Step 4: Run** the two test files and `src/__tests__/route-inventory.test.ts`, `src/__tests__/bundle-splitting.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): the guest list's switch and routes`

### Task 9: The guest list page

**Files:**
- Create: `src/pages/GuestListPage.css`, `src/components/guest-list/GuestPaste.tsx`, `GuestTables.tsx`, `GuestRows.tsx`, `GuestPanel.tsx`
- Modify: `src/pages/GuestListPage.tsx`
- Test: `src/pages/__tests__/GuestListPage.test.tsx` (extend), `src/components/guest-list/__tests__/GuestPaste.test.tsx`, `GuestTables.test.tsx`

**The screen** is the mock-up's second screen (the private page named in the lane's notes; Blake approved its look on 13 November: "Yes, build on it"). Copy the desk pattern from `src/components/dashboard/TeamView.tsx` and `TeamView.css`, with classes prefixed `gl-`:

- Root `<div className="gl" data-register="ivory">` on the sage ground; an ivory sheet; `<dl className="gl-plane ws-plane">` holding four counts that are also the filters (`<button aria-pressed>`): Guests, Seated, To seat, Tables; a ledger; and `<aside className="gl-panel" data-register="forest">`.
- Sheet head: the title (editable, defaults to the plan's name), the date (optional), then one sentence of real counts: "172 of 180 guests have a seat. 8 are still to seat."
- Ledger, by filter: **Tables** rows (number tile, the planner's own name for the table, the names in a line, "10 of 10" and "2 free"); one row can be open, showing seats 1 to n. **Guests / Seated / To seat** rows A to Z ("Fraser, Ailsa" and "Table 7, seat 3" or "No seat yet").
- Moving a guest needs no dragging: choose a name (a button), then a free seat or a table (buttons). `Escape` lets go. Every control is reachable by keyboard and at least 44 px tall.
- Panel: the three facts in large numerals (date, guests, tables); **Next step**, one primary button chosen by state, in this order: "Paste a list" (no guests), "Use the room's 18 tables" or "Set the tables" (guests, no tables), "Seat everyone" (anyone to seat and a free seat), "Print the table plan"; **Still needed** lines; **Paper** links to the four sheets; then the keeping line and "Download the list", "Delete the list from this device" (confirmed in the panel, not in a browser dialog) and "Undo".
- A secondary link "Open the room" goes to `/plan/:code`.

**Words, exact:**
- After a paste, before adding: "180 names found. Only names and parties are taken. 1 other column is left on your computer." Then the button "Add 180 guests".
- Skipped rows: "3 rows were left out: 1 name over 80 characters, 2 beyond the 600 a list can hold."
- Keeping line: "These names are kept only in this browser, on this device. Nothing is sent to Venviewer. They are removed on 12 July 2027, 30 days after the event." (or "... 90 days after your last change.")
- Storage refused: "This browser is not keeping the list. It will be gone when you close this tab. Download it before you leave."
- Unreadable: "A list was kept here for this plan, but it cannot be read." with "Start a new list".
- Repaired: "3 guests were sent back to seat, because their table or seat was no longer there."
- Other tab: "This list was also changed in another tab. This tab's version was kept."
- Room gone: "The room for this plan could not be opened, so its tables were not counted. Your list is unaffected."
- Tables differ: "The room has 17 tables; your list has 18."
- Still needed, one line each, only while true: "8 guests have no seat"; "There are no tables yet"; "The table
  plan has changed since it was printed" with "Printed 10 November" beside it; "The table plan has not been
  printed". With none true: "Nothing else is needed for the paper."
- Opening: `<ActivityStatus variant="panel">Opening your guest list…</ActivityStatus>`.

- [ ] **Step 1: Write the failing tests** (Review Focus 2 and 4 are shown here). Mock only `../../api/configurations.js` (`getPublicConfig`) and inject a memory store, as `PlanViewPage.test.tsx` mocks its one network module.

```ts
it("shows the working state while the list opens, then the desk", async () => { /* role=status, then gl-desk; data-activity-indicator gone */ });
it("paste, add, tables, seat: the sentence and the four counts follow", async () => {
  // paste 180 names -> "Add 180 guests" -> "Use the room's 18 tables" -> "Seat everyone"
  expect(screen.getByText("180 of 180 guests have a seat.")).toBeTruthy();
});
it("says only names and parties were taken, and how many columns were left", async () => { /* 4-column paste */ });
it("a guest is moved with the keyboard alone", async () => { /* Tab to a name, Enter, Tab to a free seat, Enter */ });
it("removing a table shows its guests under To seat with the count", async () => { /* ... */ });
it("says the list is not being kept when storage refuses, and still seats guests", async () => { /* refusingBackend */ });
it("when the plan answers 404, says the room could not be opened and keeps the list", async () => { /* ApiError 404 */ });
it("says when the room's tables and the list's differ", async () => { /* plan has 17 */ });
it("deleting asks first, in the panel, and then the list is gone from the store", async () => { /* ... */ });
it("asks the plan once, with no body, and asks nothing else", async () => { /* getPublicConfig called once; global fetch not called */ });
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the page and the four components to the screen and words above. The textarea takes the paste; nothing is read from the clipboard by script. On opening, run `guestListStore().sweep(Date.now())` once.
- [ ] **Step 4: Run** the page and component tests and the guards: `src/__tests__/activity-convention.test.ts`, `house-tokens.test.ts`, `calm-hover.test.ts`, `interaction-contract.test.ts`, `n1-grep-gates.test.ts`, `public-claim-guard.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): the guest list page`

### Task 10: The paper

**Files:**
- Create: `src/pages/GuestPaperPage.css`
- Modify: `src/pages/GuestPaperPage.tsx`
- Test: `src/pages/__tests__/GuestPaperPage.test.tsx`, `src/pages/__tests__/guest-paper-css.test.ts`

**The sheets** (`?sheet=`; an unknown value shows the table plan):

| Sheet | On paper |
|---|---|
| `table-plan` | Eyebrow (date and room name as the planner typed them), the title, "Please find your table", names A to Z in columns under their letters, each with its table number; foot: "Version 6 · printed 13 November 2026" |
| `by-table` | Each table: its number, the planner's name for it, its guests by seat |
| `place-cards` | One card a seated guest: the name, and "Table 7". Ten cards to an A4 page, 90 mm by 55 mm, with cut marks |
| `covers` | "172 covers, 18 tables", covers by table, and the line "No guest's name is on this sheet. Diets and allergies are not held here: ask each guest, or give the kitchen a count." |

Above the paper, on screen only: which sheet, the count ("172 names"), the line "8 guests have no seat, so they are not on it" when any are unseated, the four sheet links, "Print" and "Back to the list".

- [ ] **Step 1: Write the failing tests**

```ts
it("the table plan holds exactly the seated guests, under their letters", async () => { /* 172 entries; no unseated name present */ });
it("says how many guests are not on it", async () => { expect(screen.getByText("8 guests have no seat, so they are not on it")).toBeTruthy(); });
it("the covers sheet holds no guest's name", async () => { /* canary guest name absent from the sheet's text */ });
it("Print waits for the fonts, records the version, saves, then prints", async () => {
  // document.fonts.ready is a deferred promise; window.print is a spy
  expect(printSpy).not.toHaveBeenCalled();   // before fonts resolve
  // after: store.list.paperVersion === 1, flush awaited, printSpy called once
});
it("an unknown sheet shows the table plan", async () => { /* ?sheet=nonsense */ });
// guest-paper-css.test.ts reads the stylesheet as text, as pages/hallkeeper/__tests__/day-board-css.test.ts does
it("on paper the tools are hidden, the ground is white and a card never splits across pages", () => {
  expect(printBlock).toMatch(/\.gp-tools\s*\{[^}]*display:\s*none/);
  expect(printBlock).toMatch(/break-inside:\s*avoid/);
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Print rules follow `src/components/proposal/ProposalDocument.css:318-335`: `@page { size: A4; margin: 14mm; }`, white ground, near-black ink, `break-inside: avoid` on a letter group's heading with its first entry, on a table's block and on a card; `break-after: page` after each tenth card. The Print button's handler: `await document.fonts.ready`, `apply((l) => markPrinted(l, now))`, `await flush()`, `window.print()`.
- [ ] **Step 4: Run the tests and the guards of Task 9.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(kit): the table plan, place cards and covers on paper`

### Task 11: No name leaves the device

**Files:**
- Test: `src/lib/guest-list/__tests__/no-names-leave.test.ts`

- [ ] **Step 1: Write the tests**

```ts
it("no source file of the kit builds an error, a log line or a class name from data", () => {
  // read every file under lib/guest-list, components/guest-list, stores/guest-list-store.ts, pages/Guest*.tsx
  // forbid: /new Error\(\s*`[^`]*\$\{/ , /console\./ , /className=\{`[^`]*\$\{/ , /reportFailure\(|captureWarning\(/
});
it("no source file of the kit imports the API client, except the one read of the plan", () => {
  // only pages/GuestListPage.tsx may import "../api/configurations.js"; nothing imports "../api/client.js"
});
it("a canary name survives the whole journey without appearing in any thrown or returned error text", async () => {
  // "CANARY-Q7" through parsePaste, takeNames, addGuests, seatEveryone, tablePlanAZ, toCsv and a refusing store
});
```

- [ ] **Step 2: Run the test file.** Expected: PASS (the earlier tasks obeyed the constraint). If it fails, fix the code it names, not the test.
- [ ] **Step 3: Commit** `test(kit): no guest's name leaves the device or reaches an error report`

### Task 12: The journey, counted

**Files:**
- Create: `e2e/guest-list-journey.spec.ts`
- Modify: `e2e/accessibility-route-audit.spec.ts` (append one `RouteSpec`: the guest list page, `contrastTarget: "client"`)

- [ ] **Step 1: Write the spec**, mocking the API as `e2e/planner-guest-entry.spec.ts` does (abort everything, fulfil only `GET /public/configurations/<id>` with a Grand Hall dinner of 18 round tables).

```ts
test("from opening the page to the print dialog in the step budget, and nothing is sent", async ({ page }) => {
  // count clicks with a capture-phase listener; stub window.print; record every request's method, url and body
  // open /plan/<id>/guests?kit=on ; "Paste a list" ; paste 180 names (one of them CANARY-Q7) ; "Add 180 guests" ;
  // "Use the room's 18 tables" ; "Seat everyone" ; "Print the table plan" ; "Print"
  expect(clicks).toBeLessThanOrEqual(10);
  expect(typedFields).toBeLessThanOrEqual(3);
  expect(printCalls).toBe(1);
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  expect(requests.some((r) => (r.url + (r.body ?? "")).includes("CANARY-Q7"))).toBe(false);
});
test("the list is still there after a reload", async ({ page }) => { /* reload; 180 of 180 */ });
test("the table plan prints readable, on whole pages", async ({ page }) => {
  // as e2e/ops-handoff-print.spec.ts: emulate print media, page.pdf(), page count >= 1,
  // unreadableOnPaper(page, ".gp-sheet", state) is empty
});
```

- [ ] **Step 2: Run** through the machine's queue for heavy checks: `pnpm -F @omnitwin/web exec playwright test e2e/guest-list-journey.spec.ts`. Expected: 3 passed.
- [ ] **Step 3: Commit** `test(kit): the guest list journey within its step budget`

### Task 13: Whole-branch checks and hand-over

- [ ] **Step 1: Run, one at a time through `heavy-hold.sh`:** `pnpm -F @omnitwin/web typecheck`; `pnpm -F @omnitwin/web lint`; `pnpm -F @omnitwin/web test`; `pnpm -F @omnitwin/web build`. Expected: all pass. After the build, `src/__tests__/public-copy-sweep.test.ts` must pass against `dist/`.
- [ ] **Step 2: Confirm the page's chunk is small.** In the build's output the `GuestListPage` and `GuestPaperPage` chunks must not include `three` (check the chunk's imports in `dist/assets`). If `lib/catalogue.ts` pulls it in, read the plan's tables through `CANONICAL_ASSETS` from `@omnitwin/types` in `plan-tables.ts` and keep Task 6's tests.
- [ ] **Step 3: Look at it.** Start the dev server, open `/plan/<a plan's id>/guests?kit=on` at 1360 px and 390 px, paste 180 names, seat them, open each sheet in print preview. Compare with the mock-up. Capture the screen and the print preview for the pull request.
- [ ] **Step 4: Update the record.** Add the session-log entry and T-719's ledger note (only once the pull request that carries those rows has merged), saying: built behind `?kit=on`; names never leave the device; nobody has yet watched a planner use it.
- [ ] **Step 5: Open the pull request,** send its tested head to orchestration and the release lead, and never push after that.

---

## What this plan leaves for later plans

- A way into the page from the planner's own chrome (its owners' file): asked of them, not built here.
- Accounts that keep a list, links for the client, the caterer and the venue, a planner's own room, and the
  venue's page: stages 1 (the rest), 2 and 3 of the spec, each with its own plan and, where it changes the
  database, its own merge slot.
- Dragging a name to a seat. Choosing works by pointer and keyboard; dragging is an addition, not a need.
- Binding a guest's table to the table in the room by id, once the redesigned planner is in the product.
