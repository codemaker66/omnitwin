# The Day Board, the sentence first (direction A), with a calm live (T-753)

**Status:** Blake approved this design on 22 November 2026 for the office screen, the wall and the phone. It follows T-688 (concept C, the rooms), which stays live until this ships.

## Intent

A hallkeeper should understand the day in one breath:

- first the day's sentence;
- then the one thing to take;
- then every room as it is now, and what comes next.

On an office screen all six rooms show on the first screen, and nothing daunts the reader. Red means trouble, and only trouble.

## How it was chosen

- **How the concepts were drawn.** They used the desks' register, starting from the live board's own capture and the house's tokens and faces. Every concept showed the crowded Saturday fixture at 14:20.
- **How they were judged.** Each had a one-look review by an independent reviewer, who answered ten hallkeeper questions and scored calm, glance and finish from 1 to 10. Each also had a string-by-string proofread.
- **Today's board as the baseline** (calm / glance / finish):

  | Screen | Score |
  |---|---|
  | Office | 5 / 6 / 6 |
  | Wall | 6 / 6 / 7 |
  | Phone | 6 / 5 / 6 |

  On the office screen and the phone, the live functions and the next times sit below the fold.
- **The directions:**

  | Direction | Score |
  |---|---|
  | C, finished | 7 / 5 / 7 |
  | A, the sentence first | 7 / 8 / 8 |
  | B, now and next | 7 / 8 / 8 |
  | The day on a time sheet | 7 / 7 / 6; its block times could not be drawn reliably |

  Blake chose A.
- **Live's colour.** A was drawn twice, once with live in oxblood and once calm.
  - With oxblood, every reviewer read the live rooms as rooms in trouble. With the calm live, none did.

    | Screen | Oxblood live | Calm live |
    |---|---|---|
    | Office | 8 / 8 / 8 | 8 / 8 / 8 |
    | Wall | 8 / 7 / 8 | 8 / 8 / 8 |
    | Phone | 8 / 6 / 8 | 8 / 7 / 8 |

  - Blake chose the calm live. This supersedes the 10 November decision that live stays red.
- **Photographs.** On the Day Board, rooms are pictured empty, in views reprojected from the venue's own 8K panoramas. A photograph names its room and never implies an event. This was Blake's choice. The Enquiries desk keeps its photographs.

## What exists today (master `a36daea85`)

- **The page:** `pages/hallkeeper/DayBoardPage.tsx`.
  - The office head (`750–771`): the overline and greeting, the title, the day controls and the status line (`557–569`).
  - The summary (`292`), from `boardSummary` (`lib/day-board-rooms.ts:244–263`).
  - The next action (`267–289`). It opens the slot; nothing on the board claims a request.
  - The copper plane (`585–615`), from `planeStages` (`lib/day-board-rooms.ts:113–134`). Each count filters the rooms through `roomInFocus`.
  - The rooms (`645–664`), drawn by `RoomRow` (`DayBoardRooms.tsx:311–401`): earlier, the lead, next, later, and the bar.
  - The rail of unowned requests (`219–261`), urgent first and then oldest (`lib/day-board-state.ts:946–950`).
  - The opened slot (`DayBoardSlotDetail.tsx`), the tools (`802–811`), the legend (`668–684`) and the wall (`692–735`).
  - Print: `day-board.css:2067–2201`.
- **Claiming a request.** The claim belongs to the slot's requests lane: `useSlotRequests().move(request, { to: "accepted" })`, offered as "I'll do it" when the hallkeeper can accept.
- **Live** (`day-board.css`).
  - `--lt-live: var(--vv-oxblood)` (`41`) colours, through `--db-tone`, the room's edge, the dot, the verb's wash, the bar and the legend chip.
  - The slab's glow reads it directly (`1157`).
  - The forest detail panel draws live in lit brick, as it draws at risk (`1475–1476`).
  - Live is coloured only on the Day Board: the Diary's live is green, and the planner's ribbon has no live colour.
  - `--vv-oxblood` is also the refusal colour in eleven other files. It does not change.
- **Photographs.** `roomPhoto()` (`components/dashboard/enquiries/enquiry-room-photo.ts:34`) is shared with the Enquiries desk.

## The change

### Office

1. **The head.** An overline gives the day and the venue time ("SATURDAY 14 NOVEMBER · 14:20").
   - To its right, quieter, sit the day controls (‹ Today › and the date field) and the status line (live / reconnecting / Refresh).
   - The day's sentence (`boardSummary`) becomes the visible headline, in Newsreader.
   - "The Day Board" stays the page's h1 for assistive technology, visually hidden. The greeting is dropped.
2. **The next action.** One line:
   - a label: "URGENT" in brick capitals for an urgent request, otherwise "Take now";
   - the request's words;
   - a **Take it** button that claims the request through the lane's `move(..., { to: "accepted" })` when the hallkeeper may accept.

   Otherwise the line opens the slot, as today. The working and failure states use `Activity`. The announcer still speaks each new next action once.
3. **The counts.** One quiet line of counts replaces the copper plane. Each count is a toggle that filters the rooms as the plane did: "2 at risk · 3 live · 1 setting up · 7 still to come".
   - "Bookings" leaves the line, because it invited a sum that does not add up.
   - The requests count moves to the panel's heading.
4. **The rooms.** Six cards in two columns, in the venue's own order. Each card holds:
   - the room's photograph and its name;
   - the now line (the state dot and its words);
   - the function, with its time and guests;
   - the reason, when the room is at risk;
   - the next function, as "then 18:30 · …".

   The function line is the slab's button and opens its detail, as the lead slab does today. An "All of today" disclosure lists every other slot of the room as buttons, so every slot stays one tap away.

   The card drops:
   - the earlier and later lines;
   - the day bar;
   - the "N bookings" count;
   - the request rings (the requests live in the panel).
5. **The panel.**
   - The heading "Unclaimed requests" and "N waiting".
   - The order stays urgent first, then the longest wait. The note under the heading says "longest wait first", or "urgent first, then the longest wait" while an urgent request remains in the list.
   - The request in the next-action line is not repeated in the list.
   - The first four show, then "Show all N".
   - An opened slot still takes the panel's place.
6. **The legend** stays at the foot, collapsed under "What the colours mean". The tools row stays.

### Wall

The wall speaks the same language.

- **The head:** the overline (the day), the sentence over two lines, and the large clock.
- **One band:**
  - the counts, as spans: nothing opens on the wall;
  - the next action in words, with no button.
- **Six cards**, each with:
  - a generous photograph;
  - the now line in large type;
  - the function, the reason and then the next.

  There are no bars and no request counts on the cards.
- **Kept:** the forest frame, the wake lock and the burn-in drift.

### Phone

- The sentence is the headline. Its room names link to their cards.
- The next action is a forest card, still pinned to the top. It has a full-width **Take it** when the next action is a request.
- Then the line of counts.
- Then the rooms, one to a row, each with a small square photograph, in the venue's order.

### Live, calm, on every register

- **The live mark.** `--lt-live` becomes the house ink. The live dot is an ink dot inside a thin ink ring.
- **The breath.** The ring breathes; live keeps the one ambient motion. The slab's oxblood glow is removed.
- **The live edge** is ink. On the forest panel, live is sage-lit, not brick.
- **Red stays** for at risk and the exceptions. Brick stays for urgent.
- **`attention-system.md` is rewritten to say so, dated 22 November 2026:** the Live row, the ramp sentence, and laws 5, 6 and 9.

### Photographs

- **The assets.** A new `public/images/rooms/day-board/` holds four rooms at 480, 768, 1120 and 1536 px wide. Its `provenance.json` records each panorama sweep, the yaw, the pitch and the field of view. The files carry no metadata.
- **The mapping.** A `dayBoardRoomPhoto()` serves Trades Hall:
  - these views for the Grand Hall, the Saloon, the Reception Room and the Robert Adam Room;
  - the supplied Diary photographs for the galleries.

  `roomPhoto()` and the Enquiries desk are unchanged.

## What stays

- The corrected clock and the venue's day boundary.
- The stale and frozen band.
- Day stepping and its keys.
- The filters.
- The opened slot and its focus return.
- Observation taps.
- The slot requests lane's mount contract.
- The wall's wake lock and drift.
- Print: every room and slot, in words, in black. New classes join the print-hidden list.
- Reduced motion and the announcer.

## Tests and checks

- **Written first:**
  - **Take it** claims through the lane, shows its working and failure states, and is absent when the hallkeeper cannot accept.
  - The counts filter the rooms.
  - Each card shows the now line, the function, the reason and the next.
  - Every slot is reachable through "All of today".
  - The panel never repeats the next action's request, keeps urgent first and then the oldest, and shows the right note.
  - Live uses ink and the ring, never oxblood or red.
  - The Day Board's photograph map is right, and the Enquiries desk's is unchanged.
- **Updated:** the page, library and e2e assertions that pin the old layout.
- **The contrast and legend-uniqueness audits** stay and pass.
- **The browser gate:** the phone case is restated one for one, because its bars are gone. That needs an admission, the README and the reconcile tests. The other three Day Board cases keep their titles.
- **Visual checks:**
  - `day-board-visual-check.mjs` and `crowded-day-demo.mjs` are updated;
  - captures at 1366×641, 1536×704 and 1920×953;
  - a 390×844 phone;
  - the 1920×1080 wall.
- **Then:** type checks, lint, the web suite and the Day Board e2e specs.

## Rollback

UI only, with no API or data change: revert the merge.

## What only Blake decides

- Acceptance of the look on the live page.
- Whether any other surface's live should follow.

## Done when

- Production `/hallkeeper/today` shows A on the office screen, the wall and the phone, with the calm live and the empty-room photographs.
- The unauthenticated live check passes.
- Blake's signed-in look accepts it.
