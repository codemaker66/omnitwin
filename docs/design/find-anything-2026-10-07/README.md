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
   "Saturday 14 November 2026". Find reads the Diary for that day and answers in place, room by room,
   in the Diary's own words ("Grand Hall — Confirmed, Fraser wedding, 13:00–23:00", "Saloon — Free"),
   so the question asked most on the phone needs no page to be left (added 8 October, after the first
   release; `pages/diary/lib/day-answer.ts` gives Go to date and Find one wording). Enter opens the
   Diary on that date with Go to date answering. A day is read once while Find is open and a newer
   date cancels an older read; if the Diary cannot be read, Find says so and Enter still opens it. A
   bare month or a name ("June", "May Henderson") is not a date.
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
  opens, Escape closes and hands focus back. A press anywhere in Find but its field and buttons keeps
  the cursor in the field, so no keystroke reaches the page behind, and the Diary takes no key while any
  modal is open. Escape belongs to an input method while it is composing.
- **Enter never does nothing.** The first row is active, so the best finding is ready as it arrives;
  while clients are still being searched the search row is there, so Enter takes the reader to the
  Clients desk rather than nowhere. Once the person moves to a row (arrows or pointer), findings arriving
  later never move it. The board offers only what Enter can open: bookings the board shows, and
  enquiries only to those who may hold a date.
- **Stale answers are dropped.** Only the answer to what is typed now is shown, and a typed date asks
  no client search. The board's findings are read again when the board changes while Find is open.
- **Honest states.** The line under the input says what this person's Find covers. "Searching clients…"
  is the shared `ActivityStatus`; dates, pages and the board answer at once beside it. A failed search
  says "Clients could not be searched." with Try again, and the rest still works. Nothing found says so
  in a polite region that is always present, so it is announced.
- **Scope follows the API.** No row is offered that the API then refuses: pages come from the header's
  gates; clients are searched only for the roles `/clients/search` admits and only for an account
  connected to its venue; deals and proposals only reach those who work the commercial record, as the
  search itself decides.
- **Not over another dialog.** Ctrl/⌘K does nothing while another modal dialog is open (no
  modal-on-modal). Pressed again while Find is open, it closes. A tap on the dim backdrop closes on its
  click, so it never falls through to the page. A page keeping its own address current (a replace)
  leaves Find open; moving elsewhere closes it. On a layout without Latin letters the K key works by
  position; Dvorak's Ctrl+T stays Ctrl+T. A date found on the Diary keeps its zoom.
- **The header.** Find reads as a search field from 1536 px and is its 44 px magnifier below, as on a
  phone. Measured on an admin's full row with the unread bell, the nav never overflows from 1920 to
  961 px: the compact row now starts at 1365 px, and below 1100 px the items draw in a little. This
  also clears an overflow production had for admins with unread notices at 1151–1200 and 961–980 px.
- **Calm.** An ivory overlay sheet under the header in the register's own tokens; the active row is the
  forest band with cream words; 16 px input (no phone zoom), nothing under 12 px, AA throughout. No
  entrance motion at all: a tool opened from the keyboard many times a day answers at once (the house
  motion rules, emil-design-eng). A free room reads in the register's sage ink, the word saying it.
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
Clients, so for sales it led to "Role restricted". It now shows only to those who can open Clients
(`DashboardPage.clients-link.test.tsx`, seen to fail with the gate removed).

## Review

A max-effort review of the first two commits found one high point (the browser cases not yet admitted
to the gate, which was the next step), five medium and eight lesser. All were fixed, each with a test:
focus leaving the field, board rows Enter could not open, a backdrop tap falling through, board
findings going stale, a test that could not fail, the Diary's zoom, venue-less accounts, a replace
closing Find, the Dvorak and IME keys, the live region, forced colours and a 36 px button. Its
unmeasured header-width doubt was measured and was right; the header section above is the fix.

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
