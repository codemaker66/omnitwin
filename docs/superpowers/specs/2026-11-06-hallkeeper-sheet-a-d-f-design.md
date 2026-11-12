# Hallkeeper sheet: A, then D, with F as the day's cover (T-696)

Blake chose on 6 November 2026, asked as a button after six studies made in Sunburst Studio
([gallery](https://claude.ai/artifact/WboGUWt6ZzqjDoDhZi5y4s)): "A + D, F as cover". Page 1 becomes A (the brief
with the room), page 2 becomes D (the five steps to tick), and F prints as a once-a-day cover.

Evidence: two blind reviewers per page (one look, the ten questions a hallkeeper asks; calm / glance / finish).
Today's sheet 8 / 7.5 / 8; A 8 / 9 / 8; D 8 / 9 / 8.5; F 8 / 8 / 8. Studies, prompts and reviews:
`D:/claude/hallkeeper-sheet-alternatives-20261106/`.

The task was first noted here as T-687. That number went to the redesigned planner (#358), so this work is T-696.

## Page 1: A, the brief with the room

1. Header as now.
2. Facts: Ready by · **Guests in** (was "Starts", which reviewers read as unclear when guests arrive earlier
   for a ceremony elsewhere) · Guests · Room.
3. The room beside what to keep in view.
   - Left, about 62%: the plan as the room block draws it (frozen footprints, the planner's table names,
     numbered note markers), sized to the band. A brick ring on every table the care words name
     (`careTables`).
   - Right, about 38%, on brick wash with a brick bar: **Keep in view**, one care fact per line, the place in
     semibold ink and its words in brick. Allergy notes split per sentence at the first colon; access needs as
     `accessNeeds` gives them. Then catering's meal count, **Call on the day** (name, role, phone set large,
     email), and **On duty** (the Martyn's Law lead on duty, when entered). The same words as the screen
     (`accessNeeds`, `allergyFacts`, `otherMeals`); only the setting changes.
   - No legend on page 1: each note prints under its item on page 2 with the same number.
4. The day and the store side by side, then the planner's words, as now.

### As built (rulings made in the build, 6 to 12 November)

The full Grand Hall wedding fixture did not fit A on one page at the studied type sizes. The room band stood about
340 pt tall, because Keep in view with the contacts beside a 2:1 room is much taller than the plan. The store list
took 330 pt, and the page ran 240 pt over. The studies fitted by summarising the store and leaving out the
planner's words. The build keeps every fact and changes the arrangement:

- **Two columns that each run on by themselves.** The left column (60%) holds the room, then Call on the day
  beside On duty (on the paper, as in the study, not on the brick wash), then the day in order. The right column
  holds Keep in view on brick wash, then the store. The wash marks care alone. The store starts under Keep in
  view, so neither column leaves a gap.
- **The planner's words** follow the day when that keeps the page no longer, or run full width below when they
  fit there. When page 1 has no room for them (the full wedding), they open the setup page, across it and before
  the first step, and page 1 says where they are: "Printed with the setup, before its first step."
- **The day** sets a line's date and detail after its title ("Service door opens · Suppliers and band load-in")
  when the whole line fits; otherwise it keeps the stacked form.
- **Spacing:** care lines and store lines sit a little closer. The plan's caption reads "Drawn from the saved
  layout, looking down. Copper numbers: notes, with the setup. Brick rings: keep in view." Table numbers explain
  themselves. Panel text is balanced, so a short last word never sits alone, and no line starts with " · ".
- **Measured** (header, then each column's foot): the wedding's page 1 ends 14 pt above the footer band, and the
  setup opens page 2. The board meeting takes 2 pages and the short test sheet 1.

## Page 2: D, the setup to tick (always opens a page)

1. A progress rail: one ring per step (its number, name and deadline), then **Room ready** (a copper ring) and
   **Guests in** (a quiet ring). Rings are empty: nothing is done when the sheet prints.
2. Two lanes. The steps, about 68%: a copper numeral alone in its margin column, the step's name, the deadline
   right in copper, its reason in italic serif, then rows on one grid (tick box, count, item with its chairs,
   place) with each item's notes beneath under their numbers. The rail, about 28%, on ivory: Keep in view (the
   same lines as page 1), Call on the day, On duty, and a small plan with the same rings.
3. Sign-off and Martyn's Law follow as now.

### As built

- **A setup that fits whole under the brief on page 1** (a short event) stays there, its steps full width with no
  rail: Keep in view is already on that page. A one-page sheet stays one page.
- **When the brief itself runs onto page 2** and fills less than 40% of it, the setup starts there after a rule,
  rather than leaving most of a page empty and starting on page 3.
- **The rail's contact** shows the name, role and phone a crew calls; the email stays with the contact on page 1.
- **Notes on the plan** that no setup line carries are listed after the last step under their numbers, so every
  number on the plan can still be looked up (the old legend's guarantee). The manifest normally carries each note
  under its item.
- **A setup line's height** is its item column (name, chairs, notes) or its place column, whichever runs longer.
  Notes no longer start below a long place.

## F: the day at the venue (its own PR, after A and D)

- `GET` a venue day's cover as a PDF: staff of that venue only, rendered per request, `Cache-Control: private,
  no-store` (it carries allergy and access notes).
- The venue's bookings that day on its own clock (04:00 to 04:00, as the Diary counts it); each booking's layout
  assembled by `assembleSheetDataV2`. A board of rooms against time, one card per event (ready by, guests in,
  guests, layout, from the store, approved or draft), keep in view for the whole day, call on the day, on duty.
- Unknowns are named, not invented: an end time not set; a ready time not given.

## Not built, because the data does not hold it

- Times written only inside notes (a ceremony in another room, a cash bar, door staff) are not lifted into the
  day. The day stays the structured running order.
- Seat positions: the plan rings the table and does not guess which chair is "seat 4".
- A phone number for the duty manager: none is stored, so On duty shows the name and role.
- A ceremony mentioned only in a wedding's notes gets no card on the cover until it is booked as a room use.

## Checks

- Tests first: the Guests in label; `careTables`; page 1 draws the plan beside Keep in view; page 2 opens with
  the rail and the steps; every note keeps its number on the plan and under its item; the long-text sweeps
  (nothing under the footer, no stranded rule) hold; draft and empty sheets still read.
- Renders of the four fixtures, checked by eye against the studies; two blind reviews of the real pages 1
  and 2, against today's 8 / 7.5 / 8.
