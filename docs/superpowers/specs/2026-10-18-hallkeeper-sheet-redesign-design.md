# The hallkeeper sheet, redesigned: "the brief, then the room"

18 October 2026. Blake chose direction A of three rendered directions
(evidence: `D:/claude/hallkeeper-sheet-redesign-20261018/review/`, PDFs and
true-size pages; spike code in `spike/`). This document is what to build.

## Why

Blake, on the old 7 September test sheet: keep it retired "if we are making a
new one that is far better layed out/more intelligent/not daunting and fits
out aesthetic". The sheet is the paper (PDF) a Trades Hall hallkeeper sets a
room from, served signed-in at `GET /hallkeeper/:configId/sheet`.

What today's renderer (`packages/api/src/services/hallkeeper-pdf-v2.ts`) does
wrong, measured on a full 120-guest Grand Hall wedding fixture rendered
through the real manifest generator:

- Four pages. A third of page 1 is blank because Martyn's Law could not fit;
  page 4 is 85% empty.
- Six differently tinted boxes, a full-bleed gold bar and a green band; caps
  labels everywhere. It looks like a dashboard, not a calm document.
- Helvetica, gold and green: none of the House type or colour.
- The plan has no table names, so notes such as "Table 5: severe peanut
  allergy" point at nothing on paper.
- Rows are split by zone, so one 6 x 5 dance floor prints as three rows
  (East wall 10, Perimeter 16, Centre 4).
- Totals are a run-on line at the end; nothing tells the hallkeeper what to
  bring from the store.
- Phase deadlines are chips in the header, apart from the phases they time.
- A loose chair (one not grouped with a table, such as a highchair) is listed
  twice, with its accessories. Fixed in `manifest-generator-v2.ts` with a
  regression test (done before this document).

## What the hallkeeper does with it

Before setting up: is this copy current (QR, version line), what time must
the room be ready, how many guests, which room. Then: what to fetch from the
store, the order to build in and by when, where each thing goes, and the few
facts that must not be missed (access needs, allergies, who to call). After:
sign it off.

## The design (direction A)

Portrait A4, House type and colour, ink on white.

**Page 1, the day**

1. Header: overline `HALLKEEPER SHEET · <venue>`; the event name in
   Newsreader; `<long date> · <room> · <layout>`; the copy status
   (`Approved by <name> · <copy line>` or, in brick,
   `<copy line> · not yet approved. Check with the duty manager before setting up.`,
   where the copy line is `describeSheetCopy`'s); the QR's own caption beneath.
   The paper-check QR, vector, sits top right.
2. Four facts between hairlines, light Newsreader numerals: Ready by (copper),
   Starts, Guests, Room (name, with `W × L m · H m high`). Missing times say
   why, in brick: `No booking holds this room yet` /
   `No changeover time for this room`.
3. Keep in view (a faint ivory panel with a forest rule): Access needs |
   Allergies (other special meals beneath) | Day-of contact. Same facts and words as the on-screen
   Keep in view; "None recorded on this sheet" when nothing was entered.
4. Two columns. Left, **The day, in order**: phase deadlines (`Structure
   done`), door opens/locks, the Martyn's Law team briefing, `Room ready` and
   `Event starts` (both emphasised), sorted by time, next-day times marked
   (`Sun 25 Oct`), a deadline after the ready-by time flagged in brick. Right,
   **From the store**: every placed object counted from the frozen plan plus
   implied accessories (linen), grouped Tables, Chairs, Staging and floor,
   Linen and dressing, Sound and vision, Bar and service.
5. From the planner (special instructions) and Access and load-in, under the
   day in the left column when both columns fit the page; otherwise full width,
   free to cross pages.

**The room** (on page 1 if it fits below the brief at a readable size, else a
fresh page)

6. The plan from frozen footprints, wall names round it, the planner's table
   names on tables (`Table 5` prints as `5`), and numbered copper markers on
   objects that carry a planner note, with the notes as a legend. Scale bar
   and `Drawn from the saved layout, looking down.` A supplied diagram image
   (`diagramUrl`) still takes the plan's place.
7. **Setup, in order**: steps numbered 1, 2, 3 for the phases present, each
   with `done by <time> · <reason>` from the planner's deadline. Rows merge
   the same item across zones: checkbox, quantity, name, `10 chairs each` /
   `10 chairs in all`, and where (`Centre 6 · South wall 3 …`). A note prints
   once, under the first row it belongs to, with its plan marker. A phase
   heading never sits alone at a page foot; rows never split.
8. Sign off: `Room set by ___ at ___   Checked by ___ at ___`, then the
   standing fire-safety line.
9. Martyn's Law readiness, prompts only, compact: the operator's entries in
   two columns, or, when nothing was entered, one line naming everything not
   set, so a blank is still visible. The Act's context in small print.

**Every page**: footer with `<event> · <room> · <short date>` and the copy
line (`v7, issued 16 Oct 14:02, printed 17 Oct 06:02`, from
`describeSheetCopy`) and `Page n of N`.

## Content rules (the intelligence), as pure functions in `@omnitwin/types`

- `sheetRunningOrder(sheet)`: the merged timeline above. A final-touches
  deadline equal to the ready-by time folds into `Room ready`.
- `sheetStoreList(sheet)`: counts from `floorPlan.objects` plus accessory
  rows; falls back to `totals.entries` when a legacy snapshot has no plan.
- `sheetSetupSteps(sheet)`: phases → merged items with chair counts parsed
  from the generator's `"<name> with N chairs"` names, zone breakdown sorted
  by quantity, notes deduplicated across the whole checklist.
- `sheetNoteMarkers(sheet)`: marker numbers for noted plan objects in reading
  order (top to bottom, then left to right).
- `accessNeeds`, `allergyFacts` move from the web's `sheet-facts.ts` into
  types; the web re-exports them so screen and paper share one wording.

## Payload change

`HallkeeperFloorPlanSchema.objects[]` gains optional `label` (the planner's
`metadata.displayLabel`, max 80) and `note` (`metadata.notes`, max 500).
`buildHallkeeperFloorPlan` reads them from the placed objects the assembler
already loads. Optional, so every stored snapshot still validates; sheets
frozen before this change print the plan without names or markers. Notes are
already on the manifest rows, so no new class of data enters the payload.

## Type

Newsreader and Inter, as static TrueType instances cut from the Google Fonts
files the web already self-hosts (`packages/web/src/styles/fonts/files`), by
a committed fontTools script (`packages/api/scripts/build-sheet-fonts.py`).
Faces: Newsreader Display Light (wght 300, opsz 72), Regular (400, opsz 24),
Medium (500, opsz 16), Italic (opsz 16); Inter Regular, Medium, SemiBold.
Each merges the families' unicode-range subsets (Newsreader latin, latin-ext,
vietnamese; Inter adds cyrillic and greek). Fonts live in
`packages/api/assets/fonts/` with their OFL licences and a coverage file; a
string Newsreader cannot set falls back to Inter. pdfkit cannot instance the
WOFF2 variable fonts itself (fontkit fails on them; tested).

## Constraints that do not move

- Privacy (#130): rendered per signed-in request, `Cache-Control: private,
  no-store`, never stored; `sheet-pdf-privacy.test.ts` stays green and its
  source scan extends to the new renderer modules.
- Paper check: version line on page 1 and every footer, the QR encodes
  `sheetQrTarget(...).url` (with this copy's printed minute), ink only, so a
  mono laser print loses nothing. Colour never carries meaning alone.
- Every clock is the venue's (`venue.timezone`).
- Metrics `hallkeeper_pdf_render_total` and `_duration_seconds` unchanged.
- The route, its auth and its headers are unchanged.

## Not in scope

The on-screen hallkeeper workspace (T-606) and the browser print. Event-level
sheets across rooms. Table numbering the planner did not enter. Scripts
neither face covers (CJK, Arabic) print as missing-glyph boxes, as they do in
Helvetica today.

## Done when

New renderer and derivations ship with tests: layout regressions on the four
fixtures (wedding ≤ 3 pages, board meeting ≤ 2, empty draft 1, schema-maximum
text flows without loss), every page has its footer and nothing crosses the
margins, a Polish or Greek name renders, the existing paper-check, timezone,
Martyn's Law and metrics guarantees hold. A 100% raster of every page is
inspected, in colour and greyscale. Deployed, then checked on the live
signed-in route. The old 7 September test PDF is noted as superseded in the
task row.

## Questions a builder raised, settled

From an independent read of this document against the code (18 Oct):

- **Does `label`/`note` on the plan change the snapshot fingerprint?** Yes:
  `createSnapshot` hashes the payload's `floorPlan`. The hash is recomputed
  only when a layout is submitted for review (`configuration-reviews.ts`);
  nothing compares a live hash with an approved one, and the paper check
  judges a copy by approval time, not by hash. So approved sheets and printed
  copies do not change; a labelled or noted layout's next submission freezes
  a new version that carries the names, which is the intent. (Settled.)
- **How does a plan marker meet a checklist row?** By note text. Row notes are
  the generator's `" · "`-joined union of its placements' notes; each piece
  that equals a plan object's `note` takes that object's marker. A row with
  two notes prints two lines, each with its own marker. A grouped chair's note
  never reaches a row (grouped chairs make no row), so it appears only in the
  plan legend. (My call.)
- **Which time is "Ready by"?** `timing.setupBy`, as on screen. The planner's
  final-touches deadline is its own line in the day; it folds into `Room
  ready` only when the two are equal, and is flagged when it is later. The
  briefing time is `protectedPremises.briefingAt`. Sorting is by instant.
- **Store list arithmetic.** Placed objects come from `floorPlan.objects`
  (one each, grouped chairs included); implied accessories come from manifest
  rows with `isAccessory` (their `qty` is already multiplied per parent by the
  generator). Placed objects are never accessory rows, so nothing counts
  twice. Groups by `category`: `table` → Tables, `chair` → Chairs, `stage` →
  Staging and floor, `decor` → Linen and dressing, `av` and `lectern` → Sound
  and vision, anything else → Bar, service and other. (My call.)
- **Fonts.** Committed TTF binaries (the web already commits its font files),
  OFL licences as `.txt`, coverage as `.json` (`.dockerignore` drops `*.md`
  at the root only, and nothing here is Markdown). The cut script is a
  one-off whose output is committed, not a CI step. Greek and Cyrillic set in
  Inter (Newsreader has neither). (My call.)

## Left to the builder

Module layout under `packages/api/src/services/`, exact spacing, the test
helper that reads embedded-font text back out of the PDF (pdfkit writes a
ToUnicode map), and whether `PHASE_METADATA.final.label` becomes sentence case
everywhere or only on paper.
