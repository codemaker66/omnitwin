**Read this when:** changing the staff shell's Find (Ctrl/⌘K), adding a page's own results to it, or changing what the client search admits.

# Find anything — design record (T-635, 7 October 2026)

Roadmap §3.2, Tier A #8: "typo-tolerant universal search plus a Ctrl/⌘K command palette … one keystroke
to any record while the client is on the phone". Blake's question C3 ("a header search box and a ⌘K
palette?") has the recommended default "yes to both" and is unanswered, so the default is built. The
typo-tolerant search itself shipped with X1's Clients desk (`services/client-search.ts`, pg_trgm, migration
0081); the persistent shell (N2) draws one header for every staff page. Until now only the Diary had
Ctrl/⌘K, and it searched only the range on screen.

## What it is

One **Find** in the staff header, opened by its button or Ctrl/⌘K from any page under the shell. It
takes a name, a date or a page, the way a booker says them, and opens the record where it already lives.

In the order shown, for what the person typed:

1. **A date.** When the words name a date (the Diary's own reader, `parseGoToDate`: "14 Nov", "the 5th
   of June 27", "05/06/27", "today", counted from the venue's day), and the person opens the Diary:
   "Saturday 14 November 2026 · See each room in the Diary". It opens the Diary on that date with Go to
   date answering room by room ("Grand Hall — Free", "Saloon — 1st option …"), the question asked most
   on the phone. A bare month or a name ("June", "May Henderson") is not a date.
2. **On the board** (the Diary only): its rooms, the bookings it has read and the open enquiries, as its
   own palette found them. That palette retires: one Ctrl/⌘K everywhere.
3. **Pages.** Every place this person can open, from the header's own list and gates, found by its name
   or by the words a venue team uses for it ("calendar" and "holds" find the Diary, "quotes" Proposals,
   "deals" the Pipeline, "stock" Inventory, "function sheet" the Hallkeeper's day).
4. **Clients**, for the roles the client search admits: people, organisations, deals, proposals and
   layouts, near spellings included ("Mcdonald" finds "MacDonald"), five of each, then **Search clients
   for "…"**, which opens the Clients desk with everything found.

With nothing typed it lists the pages, so it is also the keyboard's way round the workspace.

A found record opens in its own desk, by its address, so the desk's own reload and focus rules apply: a
client on the Clients desk with what was found beside them (`?q=…&client=…`; closing the client leaves
the results), a deal in the pipeline, a proposal on the Proposals desk, a layout in the planner in a new
tab (as the Clients desk opens it). Find is a jump, so the browser's Back returns to where the person was
before it. A booking or room on the board is brought into view and focused there.

## Behaviour that matters

- **Keyboard.** The input is a combobox over one listbox (`aria-activedescendant`); ↑/↓ move, Enter
  opens, Escape closes and hands focus back. Focus never leaves the input, so typing never stops.
- **Enter never does nothing.** The first row is active. While clients are still being searched, the
  search row is there, so Enter takes the reader to the Clients desk rather than nowhere. Rows that
  arrive later do not move the active row out from under a key press: it stays on the same result.
- **Stale answers are dropped.** Only the answer to what is typed now is shown.
- **Honest states.** The line under the input says what this person's Find covers. "Searching clients…"
  is the shared `ActivityStatus`; dates, pages and the board answer at once beside it. A failed search
  says "Clients could not be searched." with Try again, and the rest still works. Nothing found says so.
- **Scope follows the API.** No row is offered that the API then refuses: pages come from the header's
  gates; clients are searched only for the roles `/clients/search` admits; deals and proposals only
  reach those who work the commercial record, as the search itself decides.
- **Not over another dialog.** Ctrl/⌘K does nothing while another modal dialog is open (no
  modal-on-modal). Pressed again while Find is open, it closes.
- **Calm.** An ivory overlay sheet under the header in the register's own tokens; the active row is the
  forest band with cream words; 16 px input (no phone zoom), nothing under 12 px, AA throughout; no
  entrance motion beyond a short fade, none under reduced motion.
- **The board's render budget holds.** The query lives inside Find, so a keystroke renders Find alone
  and never the Diary's overview (pinned by `DiaryBoardPage.render.test.tsx`).

## Approaches considered

1. **Find owned by the shell, with a page able to add its own results** (chosen). One key, one look,
   everywhere; the Diary hands its board results up through the same frame a page already uses to tell
   the header its view and name, so it works inside and outside the persistent shell.
2. A `/find` page of its own. Rejected: it leaves the work the person was in, which is what a
   palette exists to avoid.
3. An inline search box in the header with a dropdown. Rejected for now: it takes the header's width on
   phones and laptops. The header's Find button reads as that search box on wide screens (magnifier,
   "Find", the key), which answers C3's "header search box" without crowding.

Keeping the Diary's own Ctrl/⌘K beside a global one was rejected: the same keys would mean two things.

## Decisions left to Blake

- **C2, who may search clients.** Sales and planners are still refused `/clients/search`; the 27 September
  session left it on Blake's answer to C2 and this keeps that rule. Their Find covers dates, pages and
  the board. If Blake gives sales the client record (C1's default lists Clients for sales), Find needs
  no change beyond the role sets.
- **B3, the team's words.** The words each page is found by are a first list (`find-model.ts`,
  `PLACE_WORDS`); the team's own vocabulary should replace it.

## Fixed alongside

The deal panel's "Open in Clients" was shown to everyone who works the pipeline, but sales cannot open
Clients, so for sales it led to "Role restricted". It now shows only to those who can open Clients.

## Not in this slice

Commands ("New booking", "New proposal"), recently opened records, and searching the whole Diary on the
server (the board's results are what it has read, as before).

## Build plan

1. `components/dashboard/find/find-model.ts` (pure): place matching with the team's words, the date row,
   client rows from the search's own grouping (`groupResults`), five per group plus the search row, each
   row's destination, and the active row held by key.
2. `FindPalette.tsx` and `FindPalette.css`: the combobox, debounced search with stale answers dropped,
   loading, failure and nothing-found states.
3. The shell: the Find button, Ctrl/⌘K, the places the header shows, and a page's `findSource` on its frame.
4. The Diary: hands its board results up, retires `BoardPalette` and its own Ctrl/⌘K, opens Go to date
   from `?goto=`, and its guide says "Find anything".
5. The deal panel's "Open in Clients" gated on Clients.
6. Unit and component tests, the Diary's render budget re-pinned, one browser spec (desk and phone, the
   accessibility audit open), admitted to the reviewed browser inventory.
7. Ship: CI, Deploy, the production receipt, and a look at the live header.
