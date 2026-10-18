# Auto-fill, the seat shortfall and the cap line

The part of the planner's first ten seconds that places furniture (red-teamed brief, fix-first item 15; the
integration check of 17 October 2026, defect 2). Read with [the planner's figures](planner-honest-numbers.md):
the venue's published figure, with who stated it and when, stays the reference; the planner never states a
capacity of its own.

## What a visitor meets

- **Auto-fill asks first.** "Banquet rounds" or "Theatre" (Guests lens, or the command deck's Auto-fill, which
  opens the Guests lens with the question asked) turns the section, in place, into "How many guests?": one
  number field, prefilled with the guest count when one is set, beside the published figure for that style and
  its source ("The venue publishes 180 for a seated dinner. Published guide · Trades Hall · 9 Jul 2026"). The
  button states what it will place ("Place 14 tables and 140 chairs"), with the spacing under it, and when the
  room cannot take the request a line says so before anything moves: "Room for 140 at this spacing; the venue
  publishes 180 for a seated dinner." No modal; on a phone it lives in the lens sheet. Placing sets the guest
  count every lens reads, and the section then says what was placed.
- **"Short N seats" has one tap.** Beside the line that states the shortfall (Guests lens; Share lens, which
  also states it), one action: "Add 16 chairs at the tables" while the tables have room, "Add tables for 16"
  once they are full. What it will do is said under it; what it did is said after (a polite status), for as
  long as the layout is the one it made. When nothing fits: "The tables are full, and there is no room for
  another at this spacing", the published figure, and the events team to ask (unless the Published section
  already carries that ask, above the published figure). Rows of chairs and standing layouts get no table fix.
- **The cap says why.** An item the venue has a fixed number of (catalogue `maxCount`; today the narrow
  platform) used to do nothing on a tap once all were placed. Now one line appears near the floor, in a polite
  status region, on desks and phones: "The venue has one of these, and it is already placed; move it to use it
  elsewhere." The placement coach (desktop) shows the same words while hovering.

## Why 220 guests placed 8 tables

Since 7 September (`8059f239`, supplied furniture) the banquet layout measured its spacing beyond each
table's complete chair ring (3.09 m across for a 6 ft round with Turini chairs), but kept the comfortable
1.2 m two-way aisle and the 0.9 m wall band meant for bare table edges, set eight to a 6 ft round, and treated
each round as a square on a straight grid. Table centres were 4.29 m apart, so a 21 × 10.5 m room held four by
two: 8 tables, 64 chairs, whatever was asked, with nothing said.

## The spacing now

| Rule | Value | Where |
| --- | --- | --- |
| Clear behind every chair (tucked in), to the next table's chairs or the wall | 0.6 m | `BANQUET_CHAIR_CLEARANCE_M`, `lib/auto-fill.ts` |
| Seats at a table | The catalogue's recorded seat count for the table, or for a table of the same shape and size (the cloth-dressed 6 ft rounds take the 6ft Round Table's 10), never more than fit | `banquetSeatsPerTable`, `lib/table-group.ts` |
| A round group | A circle from the table's centre to its chairs' outer corners (1.559 m for a 6 ft round with Turini chairs) | `tableGroupPlanningRadius` |
| Arrangement | The straight grid when it holds the tables asked for; otherwise the most of the grid and staggered rows in either direction (rows offset half a step, as rounds are usually set) | `planBanquetLayout`, `lib/auto-layout.ts` |

The 0.6 m comes from banquet hire guidance (24 in as the minimum aisle between chairs); for 6 ft rounds with
the Turini chair it leaves about 1.9 m between table edges, in line with the 6 ft commonly advised between
72 in rounds. It is above the 0.45 m the circulation scale calls impassable and is a planning figure, not an
escape-route width. Theatre keeps its existing spacing (rows 0.9 m apart, a 1.1 m centre aisle, 2.4 m clear
at the front), now stated beside the button.

In the Grand Hall this gives 14 rounds of ten (140) in staggered rows, 5-4-5, against the venue's published
180 for a seated dinner; the venue's own dinner layouts are tighter than the planner's spacing. 100 guests
take a straight grid of 10. The Saloon (12 × 7 m) takes 3 rounds at this spacing against a published 60: the
line says so and the events team is the way forward. These are the planner's own arithmetic at a stated
spacing, never the room's capacity.

## Code

| Piece | Code |
| --- | --- |
| Plan and words for a fill | `lib/auto-fill.ts` (`planAutoFill`, `roomAtSpacingLine`, `autoFillActionLabel`, `autoFillBasis`) |
| Shortfall plan, apply and words | `lib/seat-shortfall.ts` |
| Cap line | `lib/placement-cap.ts`, `stores/placement-notice-store.ts`, `components/editor/PlacementNotice.tsx` |
| Store actions | `autoArrangeBanquet` and `autoArrangeTheatre` return what they placed; `fillSeatShortfall(guests)` writes once and announces the new ids (`announcePlaced`), so one undo takes it back; `placeItem`, `placeTableGroup` and the ghost post or show the cap line |
| Interface | `components/editor/cockpit/AutoFillPrompt.tsx`, `SeatShortfallFix.tsx`, `AutoFill.css`; `stores/auto-fill-request-store.ts` carries the command deck's request to the Guests lens |
| Ask | `LayoutQuestion` in `lib/unrecorded-ask.ts`: "We are planning 170 guests for a seated dinner in the Grand Hall. The plan has 140 seats, with no room for another table at the online planner's spacing. How would you lay the room out for 170?" It states seats placed, never a capacity; the Guests and Share lenses both offer it. |

## Checks

`lib/__tests__/auto-fill.test.ts` (the Grand Hall's real dimensions: counts, every circle and wall 0.6 m
clear, circulation unflagged, words), `auto-layout.test.ts` (staggered rounds), `seat-shortfall.test.ts`,
`placement-cap.test.ts`, `table-group-imported-defaults.test.ts` (exact chair outlines 0.6 m apart),
`stores/__tests__/placement-store.test.ts` (counts, cap line, one write and one announcement, the timeline
lock), `src/__tests__/auto-fill-undo.test.tsx` (one undo through the editor history), and the component flows
at 1280 px in the dock and 375 px in the lens sheet (`AutoFillFlow.test.tsx`, `PlacementNotice.test.tsx`,
`ShareLensPanel.test.tsx`, `PlannerCommandDeck.test.tsx`, `PlacementGhost.pointer.test.tsx`).

## Open

- The spacing is one fixed figure. A venue may want its own (its published layouts are tighter); that would be
  a venue setting with who set it and when, not a planner default.
- No inline Undo beside "Added 16 chairs at 8 tables."; the planner's Undo takes it back.
- When honest-numbers round 2 (PR #105) lands, its Share summary states the shortfall itself; set the Share
  lens's `SeatShortfallFix` to `statement={false}` then, so it is not said twice.
