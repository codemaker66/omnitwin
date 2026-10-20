# Hallkeeper sheet redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hallkeeper sheet PDF with direction A ("the brief, then the room") in House type and colour, with the derived store list, merged day timeline, named plan and merged setup steps.

**Architecture:** Pure content rules live in `@omnitwin/types` (`sheet-brief.ts`) so screen and paper share them. The renderer splits into focused modules under `packages/api/src/services/sheet-pdf/` (fonts, style, flow, blocks); `hallkeeper-pdf-v2.ts` stays the public entry and composes them. Static Newsreader and Inter TTFs ship in `packages/api/assets/fonts/`.

**Tech Stack:** TypeScript strict, pdfkit 0.18 (fontkit inside), qrcode 1.5.4, Zod, Vitest, fontTools (offline font cut only).

**Spec:** `docs/superpowers/specs/2026-10-18-hallkeeper-sheet-redesign-design.md`. Spike (throwaway, reference only): `D:/claude/hallkeeper-sheet-redesign-20261018/spike/{kit,blocks,directions}.mts`.

## Global Constraints

- Colours from `WORKSPACE_COLOURS` (`packages/types/src/design-tokens.ts`): ink `ink-1` #14302a, `ink-2` #42584e, `ink-3` #55655c; rules `rule` #d9d4c2, `rule-strong` #bfc0ac, `edge` #747f6f; accent `copper-text` #94491f; alert `brick-text` #8a3522; panel `paper` #faf8f1 with a `forest` #264337 rule. Colour never carries meaning alone; every alert has words.
- Type: Newsreader (titles, numerals, notes in italic) and Inter (everything else); tabular figures (`features: ["tnum"]`) on times and quantities.
- Page: portrait A4 595.28 × 841.89 pt, 40 pt margins, nothing full-bleed, footer on every page.
- Every clock on the venue's zone (`venue.timezone`).
- Privacy: no storage, no redirect; route headers unchanged (`Cache-Control: private, no-store`).
- Paper check: `sheetCopyLine(data)` text on page 1 and in every footer; QR encodes `sheetQrTarget(data).url`; `sheetQrTarget` and `sheetCopyLine` keep their exports and outputs.
- Metrics: `hallkeeper_pdf_render_total{status,approval}` and `hallkeeper_pdf_render_duration_seconds{approval}` unchanged.
- Words shared with screen: "Keep in view", "Access needs", "Allergies", "Day-of contact", "Ready by", "None recorded on this sheet", "None on this sheet".
- Windows: run vitest one file at a time if memory is short (`.claude/gotchas/windows-v8-heap.md`).

## Review Focus

- A three-line event name: facts row starts below the title's last line; the QR never overlaps text. (Task 5 test `long title pushes the facts down`.)
- Unbroken long strings (an email address, a URL) in notes and contact: wrap inside the margins. (Task 5 test `nothing crosses the margins` on `longTextSheet`, which carries a long email.)
- A legacy approved snapshot with no `floorPlan` but a `diagramUrl` image, and one with neither. (Task 5 tests `draws a supplied diagram in the plan's place`, `says no plan was saved`.)
- A day with 12 doors × 10 events: the day-in-order column flows onto further pages instead of running off the page. (Task 5 test `a long day flows across pages`.)
- Greek or Cyrillic names in the title and contact set in Inter; a CJK name does not crash. (Task 1 `faceFor` tests; Task 5 test `sets a Greek title in Inter`.)

---

### Task 1: Static House fonts and the face picker

**Files:**
- Create: `packages/api/scripts/build-sheet-fonts.py` (from `D:/claude/hallkeeper-sheet-redesign-20261018/scripts/build_sheet_fonts.py`, plus writing `coverage.json`)
- Create: `packages/api/assets/fonts/{Newsreader-DisplayLight,Newsreader-Regular,Newsreader-Medium,Newsreader-Italic,Inter-Regular,Inter-Medium,Inter-SemiBold}.ttf`, `coverage.json`, `newsreader-OFL.txt`, `inter-OFL.txt` (copied from `packages/web/src/styles/fonts/licences/`), `provenance.json` (source file names and SHA-256 of inputs and outputs)
- Create: `packages/api/src/services/sheet-pdf/fonts.ts`
- Test: `packages/api/src/__tests__/sheet-pdf-fonts.test.ts`

**Interfaces:**
- Produces: `type SheetFace = "Newsreader-DisplayLight" | "Newsreader-Regular" | "Newsreader-Medium" | "Newsreader-Italic" | "Inter-Regular" | "Inter-Medium" | "Inter-SemiBold"`; `registerSheetFonts(doc: PDFKit.PDFDocument): void`; `faceFor(text: string, preferred: SheetFace): SheetFace` (returns `preferred` when its family covers every code point, else the Inter face of matching weight: Regular for Newsreader Regular/Italic/DisplayLight, SemiBold for Medium).
- `coverage.json` shape: `{ "Newsreader": [[lo, hi], …], "Inter": [[lo, hi], …] }` (sorted inclusive code-point ranges).

- [ ] **Step 1:** Test: `registerSheetFonts` registers all seven faces (a doc can `.font(face)` each and `widthOfString("Mackenzie–Ross")` > 0); `faceFor("Mackenzie–Ross Łódź Nguyễn", "Newsreader-Regular") === "Newsreader-Regular"`; `faceFor("Παπαδόπουλος", "Newsreader-Regular") === "Inter-Regular"`; `faceFor("Иванов", "Newsreader-Medium") === "Inter-SemiBold"`; `faceFor("王小明", "Inter-Regular") === "Inter-Regular"` (no throw).
- [ ] **Step 2:** Run `pnpm --filter @omnitwin/api exec vitest run src/__tests__/sheet-pdf-fonts.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Copy the script into the repo; add the coverage write (ranges from each merged font's `cmap`); run it: `python packages/api/scripts/build-sheet-fonts.py packages/web/src/styles/fonts/files packages/api/assets/fonts`. Implement `fonts.ts`: read the TTFs once per process via `new URL("../../../assets/fonts/<face>.ttf", import.meta.url)`, register with `doc.registerFont(face, buffer)`.
- [ ] **Step 4:** Run the test; expect PASS. Run `cd packages/api && pnpm pack --dry-run` and confirm `assets/fonts/*.ttf` are listed (the Docker `pnpm deploy` ships the same file set).
- [ ] **Step 5:** Commit (`git add` the script, the assets folder, `fonts.ts`, the test).

### Task 2: Table names and notes on the frozen plan

**Files:**
- Modify: `packages/types/src/hallkeeper-v2.ts` (`HallkeeperFloorPlanSchema` objects)
- Modify: `packages/api/src/services/hallkeeper-floor-plan.ts` (`buildHallkeeperFloorPlan`, `FloorPlanPlacement`)
- Modify: `packages/api/src/services/hallkeeper-sheet-v2-data.ts:241` (pass `metadata`)
- Modify: `packages/api/src/__tests__/fixtures/hallkeeper-sheet-fixtures.ts` (drop `PLAN_ANNOTATIONS`; placements carry `metadata`)
- Test: `packages/api/src/__tests__/hallkeeper-floor-plan.test.ts`, `packages/types/src/__tests__/hallkeeper-v2.test.ts`

**Interfaces:**
- Produces: floor-plan object fields `label?: string` (max 80, trimmed, omitted when empty) and `note?: string` (max 500, trimmed, omitted when empty). `FloorPlanPlacement` gains `metadata: unknown` (read `displayLabel` and `notes` when strings).

- [ ] **Step 1:** Tests: a placement with `metadata { displayLabel: " Table 5 ", notes: "Peanut allergy, seat 4" }` yields `{ label: "Table 5", note: "Peanut allergy, seat 4" }`; blank strings and non-strings yield neither key; a stored plan without the keys still parses (`HallkeeperFloorPlanSchema.parse`).
- [ ] **Step 2:** Run both test files; expect the new cases to FAIL.
- [ ] **Step 3:** Add the optional fields to the schema; read them in the builder; pass `metadata` from the assembler's existing `objects` select; rebuild types (`pnpm --filter @omnitwin/types build`).
- [ ] **Step 4:** Run both files plus `hallkeeper-sheet-v2.test.ts`; expect PASS.
- [ ] **Step 5:** Commit.

### Task 3: The content rules in `@omnitwin/types`

**Files:**
- Create: `packages/types/src/sheet-brief.ts`; export from `packages/types/src/index.ts`
- Modify: `packages/web/src/components/hallkeeper/sheet-facts.ts` (re-export `accessNeeds`, `allergyFacts`, `AllergyFacts` from types; delete the local copies)
- Test: `packages/types/src/__tests__/sheet-brief.test.ts`

**Interfaces:**
- Consumes: `HallkeeperSheetV2` (with Task 2's `label`/`note`), `PHASE_METADATA`.
- Produces:
  - `interface DayLine { at: string; title: string; detail: string | null; emphasis: boolean; late: boolean; nextDay: boolean }`; `sheetRunningOrder(sheet): DayLine[]` — titles `"<Phase label> done"`, `"Room ready"`, `"Event starts"`, `"<door label> opens"` / `"locks"`, `"Team briefing"` (detail `"Evacuation, invacuation, lockdown and communication"`); sorted by instant (ties keep insertion order); `nextDay` when the venue-local day differs from the event's; `late` when a phase deadline is after `setupBy`; a `final` deadline equal to `setupBy` folds into `Room ready` (its reason becomes that line's detail).
  - `interface StoreGroup { title: string; items: { name: string; qty: number }[] }`; `sheetStoreList(sheet): StoreGroup[]` — mapping and fallback as the spec's settled questions; items by qty desc then name; groups in the order Tables, Chairs, Staging and floor, Linen and dressing, Sound and vision, Bar, service and other.
  - `interface SetupItem { name: string; qty: number; chairs: { total: number; each: number | null } | null; where: { zone: Zone; qty: number }[]; notes: string[]; accessory: boolean }`; `interface SetupStep { phase: SetupPhase; label: string; deadline: { at: string; reason: string | null; late: boolean } | null; items: SetupItem[] }`; `sheetSetupSteps(sheet): SetupStep[]` — `label` sentence case (`"Final touches"`); merge key base-name + afterDepth + isAccessory; chairs parsed from `/^(.*) with (\d+) chairs?$/`; `where` sorted by qty desc; notes split on `" · "`, each kept only at its first occurrence across all steps.
  - `sheetNoteMarkers(sheet): Map<string, number>` — note text → 1-based number, objects ordered by `z` rounded to 0.5 m then `x`.
  - `accessNeeds`, `allergyFacts`, `AllergyFacts` (moved verbatim from web); `otherMeals(dietary): string | null` (`"14 vegetarian · 4 vegan · 3 halal"`).

- [ ] **Step 1:** Tests, using small hand-built sheets: the wedding-like day sorts 09:00 door before 10:00 structure, folds an equal final deadline, flags a technical deadline after ready-by as `late`, marks a 00:30 next-day lock `nextDay`; the store list counts 120 chairs from plan objects, adds 11 linen from accessory rows, falls back to `totals.entries` when `floorPlan` is null, puts an unknown category in "Bar, service and other"; setup steps merge 3 zone rows of dance-floor panels into one item of 30 with `where` sorted 16/10/4, turn `"6ft Round Table with 10 chairs"` ×11 into `chairs { total: 110, each: 10 }`, turn trestles with 3/4/3 chairs into `{ total: 10, each: null }`, print a note on the table row and not again on its linen row; markers number a top-row object before a lower one.
- [ ] **Step 2:** Run `pnpm --filter @omnitwin/types exec vitest run src/__tests__/sheet-brief.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement (port the spike's `runningOrder`, `pickList`, `setupOrder`, `markerNumbers` to typed code).
- [ ] **Step 4:** Run the test; then web's `sheet-facts` and `KeepInView` tests (`pnpm --filter @omnitwin/web exec vitest run src/components/hallkeeper`); expect PASS.
- [ ] **Step 5:** Commit.

### Task 4: Reading text back out of an embedded-font PDF

**Files:**
- Create: `packages/api/src/__tests__/helpers/pdf-text.ts`
- Test: `packages/api/src/__tests__/helpers/pdf-text.test.ts`

**Interfaces:**
- Produces: `interface PdfLine { text: string; x: number; y: number; size: number; font: string }` (y in PDF space, origin bottom-left; `font` is the BaseFont name, e.g. `…+InterSheet-Regular`); `pdfPages(buf: Buffer): PdfLine[][]`; `pdfText(buf: Buffer): string` (lines joined by spaces, whitespace collapsed); `pdfPageSizes(buf): { width: number; height: number }[]`.
- Decoding: per page, map font resource names (`/F1 12 0 R`) to font dicts, follow `/ToUnicode`, inflate it, parse `<lo> <hi> [<u> …]` ranges (pdfkit's format); decode each `<hex>` string in a BT block as 2-byte codes.

- [ ] **Step 1:** Test: a pdfkit doc with Task 1's fonts writing "Ready by 13:30", "Łódź", "Παπαδόπουλος" on two pages round-trips through `pdfPages` with the right texts, page count, a y near the drawn position, and the font names.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit.

### Task 5: The renderer, direction A

**Files:**
- Create: `packages/api/src/services/sheet-pdf/style.ts` (tokens, text styles, `text`/`height`/`width` helpers applying `faceFor`, `wrapLines(doc, style, text, width): string[]` greedy wrap that respects `\n` and breaks over-long words)
- Create: `packages/api/src/services/sheet-pdf/flow.ts` (`class Flow { x; w; y; top; bottom; ensure(need): void; paragraph(style, text, x?, w?): void }`; `ensure` adds a page when `y + need > bottom`)
- Create: `packages/api/src/services/sheet-pdf/blocks.ts` (`header`, `facts`, `keepInView`, `dayInOrder`, `storeList`, `planner`, `plan`, `setupSteps`, `signOff`, `martynsLaw`, `footers`)
- Create: `packages/api/src/services/sheet-pdf/plan-drawing.ts` (vector plan with wall names, labels, markers, legend, scale bar; uses `projectHallkeeperFloorPlan`)
- Modify: `packages/api/src/services/hallkeeper-pdf-v2.ts` (keep `generateSheetPdfV2`, `sheetQrTarget`, `sheetCopyLine`, metrics; compose direction A; QR drawn as vector from `QRCode.create(sheetQrTarget(data).url, { errorCorrectionLevel: "M" })`)
- Delete: `packages/api/src/services/hallkeeper-floor-plan-pdf.ts` (replaced by `plan-drawing.ts`)
- Modify: `packages/api/src/__tests__/hallkeeper-pdf-v2.test.ts` (switch to `helpers/pdf-text.ts`; rewrite copy assertions to the new words; keep every guarantee)
- Modify: `packages/api/src/__tests__/sheet-pdf-privacy.test.ts` (renderer scan also covers every file under `services/sheet-pdf/`)
- Modify: `packages/types/src/hallkeeper-accessories.ts:60` (`"Final touches"`) if the grep for `Final Touches` in tests is limited to label snapshots; else sentence-case on paper only

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `generateSheetPdfV2(data: HallkeeperSheetV2): Promise<Buffer>` (unchanged signature).

Copy fixed by the spec (exact): `HALLKEEPER SHEET · <venue>`; `v<n> · approved by <name>, <Sat 24 Oct> <16:12>`; `Draft · not yet approved. Check with the duty manager before setting up.`; `Printed <Sat 24 Oct> <07:42>`; `Scan: is this copy current?`; facts `Ready by`, `Starts`, `Guests`, `Room`; `No booking holds this room yet`; `No changeover time for this room`; `<n> min before the start`; `Keep in view`; `The day, in order`; `From the store`; `From the planner`; `Access and load-in`; `The room · <room>`; `Drawn from the saved layout, looking down.`; `Numbers are the planner's table names.`; `No plan was saved with this layout. Set the room from the list.`; `Setup, in order`; `Tick each line as it is done. Where each item goes is on the plan.`; `done by <time>`; `Nothing is placed in this layout yet.`; `Sign off`, `Room set by`, `at`, `Checked by`; the fire line `Fire exits must remain unobstructed at all times. Maximum occupancy must be observed per venue licence. Report any safety concerns to the duty manager immediately.`; Martyn's Law heading `MARTYN'S LAW READINESS · PROMPTS ONLY`, the summary's intro, labels and context; empty case `Nothing recorded for this event: responsible person, lead on duty, team briefing, door supervision and the four procedures are not set.`

Layout rules (exact): page 1 = header, facts, keep in view, two columns (day 54% | store), planner; the two columns render side by side only if both fit on the current page, else on a fresh page if they fit there, else stacked full width with flowing rows. The room follows on the same page if `bottom - y - 80 ≥ full plan height`; else at `spare ≥ 190 pt` with the plan shrunk to `spare`; else a fresh page. Full plan height = `min(contentWidth × length/width, 280) + 28`. Keep-in-view columns stack full width when their three-column height exceeds 300 pt. Setup rows never split; a step heading needs room for itself and its first row.

- [ ] **Step 1:** Layout tests on the four fixtures (`weddingSheet`, `boardMeetingSheet`, `emptyDraftSheet`, `longTextSheet`), each with a paper check built by `buildSheetPaperCheck`: page counts wedding ≤ 3, board ≤ 2, empty = 1; every page's lowest text line holds `sheetCopyLine` and `Page n of N`; no text line lies left of x = 39 or (by width estimate from the line's x and font size) right of 556, nor below y = 32 or above 810 except footers; the long text's last 40 characters of `specialInstructions`, `accessNotes`, `otherAllergies` all appear; the wedding's page 1 contains `Ready by`, `13:30`, `120`, `Chiavari Wedding Chair`, `Room ready`, `Sun 25 Oct`; the plan prints `Top table`, `5`, and marker legend text `Table 5: severe peanut allergy`; setup prints `Parquet Dance Floor Panel` once with `30`; `White Highchair` appears with qty `1`.
- [ ] **Step 2:** Review Focus tests: `long title pushes the facts down` (three-line name: `Ready by` y below the title's last line by ≥ 10 pt, title lines' right edge < QR x); `draws a supplied diagram in the plan's place` (no `Drawn from the saved layout` text, an image XObject present); `says no plan was saved`; `a long day flows across pages` (12 doors × 10 events: every door title present, page count grows, margins hold); `sets a Greek title in Inter` (title line font contains `InterSheet`).
- [ ] **Step 3:** Port the guarantees in the existing tests to the new words: venue clocks (`Ready by` `17:00`, `Starts` `18:30`; New York `12:00`/`13:30`); missing reasons; Martyn's Law entries and empty sentence and the no-claim rule; paper-check line on page 1 and every footer, draft wording, QR target and caption functions; metrics.
- [ ] **Step 4:** Run `vitest run src/__tests__/hallkeeper-pdf-v2.test.ts`; expect FAIL.
- [ ] **Step 5:** Implement the modules (port from the spike; no `any`; `Doc` is `PDFKit.PDFDocument`).
- [ ] **Step 6:** Run `hallkeeper-pdf-v2.test.ts`, `sheet-pdf-privacy.test.ts`, `sheet-paper-check.test.ts`, `hallkeeper-sheet-v2.test.ts`, `hallkeeper-floor-plan.test.ts` one at a time; expect PASS. Run `pnpm --filter @omnitwin/api typecheck` and `pnpm --filter @omnitwin/api lint`.
- [ ] **Step 7:** Render the four fixtures to `D:/claude/hallkeeper-sheet-redesign-20261018/final/`, rasterise at 96 and 192 dpi plus greyscale, inspect every page; fix and repeat until clean.
- [ ] **Step 8:** Commit.

### Task 6: Records, review and shipping

**Files:**
- Modify: `docs/engineering/paper-version-check.md` (the PDF section: new header and footer placement), `docs/state/tasks.md` (new task row; T-667 note that the 7 Sep test PDF is superseded), `docs/sessions/2026-10-18.md`

- [ ] **Step 1:** Full checks: `pnpm --filter @omnitwin/types test`, api tests touched above, web hallkeeper tests, typecheck for types/api/web, lint.
- [ ] **Step 2:** Independent review of the branch (code reviewer on the session model; security reviewer for the payload change).
- [ ] **Step 3:** Records updated; commit; push; PR to `master`; CI green; merge with the GitHub MCP merge tool.
- [ ] **Step 4:** Confirm the API deploy picked up the merge (Railway; `/health/version` gitSha), then open a real sheet on the live signed-in route and inspect the downloaded PDF at 100%.
