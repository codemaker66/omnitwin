# Night Shift Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth tab to Switchboard, "Night shift", that shows the cloud crew's work from one snapshot file, in the arrangement Blake picked (C, the night book).

**Architecture:** The conveyor writes `board.json` into its work folder on every tick. Switchboard reads that file through one new module, serves a bounded view of it on one new keyed route, and draws it on one new tab. Switchboard never calls Anthropic or GitHub and never holds a key; this tab is read-only.

**Tech Stack:** Plain Node 22 ES modules with no dependencies, one HTML file with inline CSS and JavaScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-21-night-shift-design.md` (in the omnitwin repository). The sibling plan `2026-11-21-night-shift-conveyor.md` owns the snapshot's shape; its Task 10 is the other side of the contract below.

**Where the code is.** Switchboard is not a git repository. Work in the copy `D:\claude\switchboard-work\next` (`src`, `test`, `README.md`). The live folder `C:\Users\blake\projects\switchboard` is only updated in Task 5. Read `D:\claude\switchboard-work\NOTES.md` before starting.

**The approved look.** `D:\claude\night-shift-20261121\mockups\night.html` opened with `#c`, and its still `r3-c-1536x704.png`. That file uses Switchboard's own stylesheet plus two new blocks of CSS, which Task 3 copies.

## Global Constraints

- No dependency, no bundler, no framework. Imports are `node:*` and local modules only.
- The content policy does not change: no outside request, script, style, font or image.
- The new route sits behind the existing Host, Origin and key checks, like every `/api/*` route.
- Switchboard reads the night shift's folder and writes nothing there. It never opens a key file.
- Everything returned to the page is bounded: text cut to 200 characters, lists cut to the limits in Task 1.
- Text reaches the page only through the existing `h()` helper. Never `innerHTML`.
- One colour. State is shown by fill, hatching and inversion, never by a second colour.
- The page must not scroll at 1366 by 641, 1536 by 704 or 1920 by 953. Panels scroll inside.
- Motion comes only from real data changing. Keep the `prefers-reduced-motion` guard.
- Keep the existing accessibility patterns: tab roles, `role="img"` with an `aria-label` on every bar.
- Tests: `node --test "test/*.test.mjs"`. There are 51 today, and all must still pass.

## The contract: `board.json`

Written by the conveyor to `<night shift folder>\board.json`, by temporary file and rename, about every two minutes. All money is integer cents. All times are ISO 8601 UTC.

```js
{
  v: 1,
  writtenAt: "2026-11-21T03:12:00.000Z",          // also the heartbeat
  heartbeat: { hadWork: true, hadCredit: true, hadRoom: true, lastStartAt: "2026-11-21T03:05:00.000Z" },   // lastStartAt may be null
  paused: null,                                    // or { at, reason }
  today: { date: "2026-11-21", spentCents: 1740, capCents: 4000, landed: 11, thrownOut: 3 },
  month: { spentCents: 5400, grantCents: 80000 },
  pots: [ { id: "pot-2", label: "…", state: "spending", grantCents: 20000, leftCents: 16300, cycleEnds: "2026-12-10", note: null } ],
        // state: "spending" | "next" | "ready" | "held" | "empty" | "unconfirmed"
  inHand: [ { id: "…", title: "…", source: "defect:…", stage: "building", doing: "…", costCents: 62, startedAt: "…" } ],
        // stage: "starting" | "building" | "being-checked" | "opening-pr"; doing, costCents and startedAt may be null
  waiting: { count: 11, next: ["…"] },             // up to 8 titles
  record: [ { at: "…", kind: "pr", title: "…", pr: 468, prState: "draft", reason: null, costCents: 84 } ],
        // newest first, at most 60; kind: "pr" | "out" | "held" | "start" | "alarm"; prState: "draft" | "ready" | "merged" | "closed" | null
  needsYou: [ { kind: "look", title: "…", detail: "…" } ]   // kind: "look" | "pot" | "key" | "alarm"
}
```

## Review Focus

1. The night shift is not set up, so the folder or the file does not exist. The tab says so plainly and nothing errors. (Task 1)
2. The file is read halfway through a write, or is not JSON. The tab says the snapshot cannot be read; the route still returns 200. (Task 1)
3. A title holds very long text or markup. It is cut to 200 characters and shown as text. (Tasks 1 and 3)
4. The conveyor is newer and writes `v: 2`. The tab says Switchboard needs updating and does not guess at the shape. (Task 1)
5. The tick has stopped. After 10 minutes with no new snapshot the tab says the shift has not ticked, and Switchboard's own notification fires once. (Tasks 1 and 4)

## File structure

| File | Responsibility |
|---|---|
| `src/nightshift.mjs` (new) | Read and bound the snapshot, decide stale and missed, and compose the tab's words. |
| `src/server.mjs` | One GET route, the module added to the self-restart list, the page level raised. |
| `src/ui/index.html` | The fifth tab, its CSS, its drawing and its polling. |
| `src/tick.mjs` | One notification rule for a stalled or paused shift. |
| `test/nightshift.test.mjs` (new), `test/fixtures/nightshift/*` (new) | The reader's and the words' tests. |
| `test/review.test.mjs` | The route's key and shape test. |
| `README.md` | The new tab, the setting, the test count. |

---

### Task 1: Read the snapshot and compose the words

**Files:**
- Create: `src/nightshift.mjs`, `test/nightshift.test.mjs`
- Create fixtures: `test/fixtures/nightshift/ok/board.json` (the sample above, filled in to match the approved still), `half/board.json` (the same file cut off mid-way), `long/board.json` (one title of 5,000 characters holding `<script>`), `v2/board.json` (`{"v":2}`), and the empty folder `absent/`

**Interfaces:**
- Produces:
```js
export const NIGHT_LIMITS = { text: 200, pots: 8, inHand: 20, record: 60, needsYou: 10, next: 8 };
export const STALE_MS = 10 * 60_000;
export const MISSED_MS = 30 * 60_000;
/**
 * { state: 'absent' } | { state: 'unreadable' } | { state: 'newer', v }
 * | { state: 'ok', stale, missedStart, ageMs, board }    // board cut to NIGHT_LIMITS
 */
export function readNightShift(dir, now = Date.now());
/** { big, small } for the top of the tab. */
export function nightWords(result, now = Date.now());
```
`stale` is true when `now - writtenAt` is over `STALE_MS`. `missedStart` is true when the shift is not paused, `hadWork`, `hadCredit` and `hadRoom` are all true, and `lastStartAt` is null or more than `MISSED_MS` ago.

The words, exactly:

| When | `big` | `small` |
|---|---|---|
| absent | `Night shift is not set up yet.` | `It appears here when the first tick writes its snapshot.` |
| unreadable | `The night shift's snapshot cannot be read.` | `The next tick should replace it within two minutes.` |
| newer | `The night shift is newer than this page.` | `Update Switchboard to read it.` |
| paused | `The shift is paused.` | the pause reason |
| stale | `The shift has not ticked for 14 minutes.` (the real number) | `Check the "Night shift - tick" scheduled task.` |
| missedStart | `There is work and credit, but nothing has started for 31 minutes.` | the first `needsYou` detail, or empty |
| landed over 0 | `Eleven fixes landed today, for $17.40.` | `Three jobs are in hand and eleven wait.` then, when anything needs him, ` Two things need you.` |
| landed 0 | `Nothing has landed yet today.` | the same small line |

Numbers up to nine are written as words with a capital at the start of a sentence, as the page's `COUNT_WORDS` does; `1` gives `One fix landed` and `One job is in hand`. The first matching row from the top wins.

- [ ] **Step 1: Write the failing tests**
```js
test('absent folder is a state, not an error', () => {
  assert.deepEqual(readNightShift(fx('absent')), { state: 'absent' });
});
test('half-written file is unreadable', () => {
  assert.deepEqual(readNightShift(fx('half')), { state: 'unreadable' });
});
test('a newer snapshot is not guessed at', () => {
  assert.deepEqual(readNightShift(fx('v2')), { state: 'newer', v: 2 });
});
test('long text is cut and lists are bounded', () => {
  const r = readNightShift(fx('long'), NOW);
  assert.equal(r.board.inHand[0].title.length, 200);
  assert.ok(r.board.record.length <= 60);
});
test('stale after ten minutes, missed start after thirty', () => {
  assert.equal(readNightShift(fx('ok'), at('03:23:00')).stale, true);
  assert.equal(readNightShift(fx('ok'), at('03:21:00')).stale, false);
  assert.equal(readNightShift(fx('ok'), at('03:20:00')).missedStart, false);
});
test('the words for a good night', () => {
  assert.deepEqual(nightWords(readNightShift(fx('ok'), at('03:12:30')), at('03:12:30')),
    { big: 'Eleven fixes landed today, for $17.40.', small: 'Three jobs are in hand and eleven wait. Two things need you.' });
});
test('the words when nothing is set up, paused, and stalled', () => {
  assert.equal(nightWords({ state: 'absent' }).big, 'Night shift is not set up yet.');
  assert.equal(nightWords(okWith({ paused: { at: T, reason: 'a control failed' } })).small, 'a control failed');
  assert.equal(nightWords(readNightShift(fx('ok'), at('03:26:00')), at('03:26:00')).big, 'The shift has not ticked for 14 minutes.');
});
```
- [ ] **Step 2:** Run `node --test test/nightshift.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. Read with `readJsonSafe` from `src/lib.mjs` (line 53); accept only the fields in the contract and drop anything else.
- [ ] **Step 4:** Run the file. Expected: PASS.

### Task 2: The route

**Files:**
- Modify: `src/server.mjs` (the GET block at lines 345 to 348; `API_LEVEL` at line 20; `codeFiles` at line 616)
- Modify: `src/ui/index.html` (`API_LEVEL` at line 216)
- Test: `test/review.test.mjs` (beside the HTTP test near line 472, which starts the real server on a random port)

**Interfaces:**
- Consumes: `readNightShift`, `nightWords`.
- Produces: `GET /api/nightshift` returning `{ ...readNightShift(dir), words: nightWords(...) }`. The folder comes from `config.json` key `nightShiftDir`, default `D:\claude\night-shift`.

- [ ] **Step 1: Write the failing test.** Start the server with a test home whose config sets `nightShiftDir` to the `ok` fixture. Without the key the route answers 403 with `{ needsKey: true }`. With the key it answers 200, `state` is `'ok'`, `board.pots.length` is 5 and `words.big` is a string.
- [ ] **Step 2:** Run `node --test test/review.test.mjs`. Expected: the new case FAILS with 404.
- [ ] **Step 3:** Add the route beside `/api/sessions`. Add `'nightshift.mjs'` to `codeFiles`, or the hidden server will not restart when it changes. Raise `API_LEVEL` to 8 in both files so open pages reload.
- [ ] **Step 4:** Run the whole suite. Expected: 51 old tests and the new ones PASS.

### Task 3: The tab

**Files:**
- Modify: `src/ui/index.html`: the stylesheet (before the `@media (max-width: 1080px)` rule at line 177), the panels (after line 208), `TABS` (line 351), `setTab` (line 352), `renderTabs` (line 359), `renderRead` (line 733), `render` (line 771), `refresh` (line 790), and the digit-key handler near line 809 (`[1-4]` becomes `[1-5]`)

**Interfaces:**
- Consumes: `GET /api/nightshift`; the page's `h`, `setKids`, `seg`, `api`, `fmtIn`, `fmtWhen`.
- Produces: the panel `#p-night`, `loadNight()` and `renderNight()`.

Layout, as in the approved still: a two-column grid, about 1.62 to 0.78. Left column: the two lines of words, "In hand" with one block per job (title; a tag for the stage; the cost and the minutes since it started; under it the `doing` line with the blinking underscore), a rule, then "Today so far" with one row per record entry, newest first, scrolling inside. Right column: "Credit" with one row and one note per pot, a rule, then the "Needs you" tag and its entries.

Fixed wording and marks:

- Stage tags: `Starting` (hollow), `Building` (solid), `Being checked` (hollow), `Opening PR` (hollow). Solid means work is happening in the cloud now.
- Record rows: a solid tag `PR 468` then the title and, on the right, `$0.84, draft` (or `ready`, `merged`, `closed`); a hollow tag `Out`, the row dimmed, showing `title: reason`; hollow `Held`; hollow `Start`; solid `Alarm`.
- Pot rows: the label, a ten-cell bar filled `Math.round(leftCents / grantCents * 10)` cells, and `$163`. The bar is hatched and the value reads `none` when the state is `unconfirmed` or `empty`.
- Pot notes: `spending now, ends Thu 10 Dec, in 19 d`; `next, ends Wed 16 Dec, in 25 d`; `ends Sun 27 Dec, in 36 d`; `held: live drafts only`; `empty until Thu 10 Dec`; `not linked: $200 a month unclaimed`.
- The tab's badge is the number of `needsYou` entries, shown the way the Status tab's badge is.
- Bottom readout while this tab is open: `TODAY $17.40` (inverted), `LANDED 11`, `THROWN OUT 3`, `IN HAND 3`, `THIS MONTH $54 of $800`, then the clock.
- The other states draw only the two lines of words and, for `ok`, whatever the snapshot holds. A stale snapshot still shows its last contents, with the pots and jobs dimmed to 60 percent.
- Poll `/api/nightshift` every 2 seconds while any job is in hand, otherwise every 10 seconds, and only while this tab is open.

- [ ] **Step 1:** Copy two CSS blocks from the mock-up into the page's stylesheet: "pieces shared by the three arrangements" and "C: the night book". Do not copy blocks A or B.
- [ ] **Step 2:** Add the panel, the `TABS` entry `['night', 'Night shift']`, and widen the digit-key handler to five.
- [ ] **Step 3:** Write `loadNight()` and `renderNight()`, and call them from `setTab`, `render` and `refresh` the way `loadSessions()` and `renderSessions()` are called.
- [ ] **Step 4:** Start a trial copy with `SWITCHBOARD_DEV=1 node src/server.mjs --port 47311` and a config whose `nightShiftDir` is the `ok` fixture. Open tab 5. Expected: it matches `r3-c-1536x704.png` apart from "today" in place of "tonight", with no console error.
- [ ] **Step 5:** Point the config at `absent`, `half`, `v2` and `long` in turn and reload. Expected: the words from Task 1's table, no error, and the long title shown as cut text with its angle brackets visible.

### Task 4: One notification when the shift stalls

**Files:**
- Modify: `src/tick.mjs` (the alert rules near line 94, which keep their state in the alerts file)
- Test: `test/desktop.test.mjs` (beside the existing notification-rule cases)

**Interfaces:**
- Consumes: `readNightShift`.
- Produces: a rule keyed `night:<kind>` where kind is `stale`, `missed`, `paused` or `alarm`. It notifies once when the kind first appears and again only after the shift has been healthy in between. The absent state never notifies.

- [ ] **Step 1: Write the failing test.** Two ticks over a stale fixture give exactly one notification with the title `Night shift has stopped`. A healthy tick then a stale tick gives a second one. The `absent` fixture gives none.
- [ ] **Step 2:** Run `node --test test/desktop.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement beside the existing rules, using the same notification call and the same alerts file.
- [ ] **Step 4:** Run the whole suite. Expected: PASS.

### Task 5: True-size checks and release

**Files:**
- Modify: `README.md` (the tab list, the `nightShiftDir` setting, the test count)
- Create: `D:\claude\switchboard-work\shots\night-*.png`

- [ ] **Step 1:** With the trial copy running, take stills of tab 5 with `D:\claude\switchboard-work\shots\shoot.mjs` at 1366x641, 1536x704 and 1920x953 for the `ok` fixture, and at 1536x704 for the absent, stale, paused and long fixtures. The script prints the page's scroll sizes: `scrollH` must equal `clientH` at every size, and there must be no "PAGE ERRORS" line.
- [ ] **Step 2:** Look at every still. Check that nothing is clipped, that all three phosphor colours read well (`amber`, `green`, `ivory`), and that the `ok` still matches the approved one.
- [ ] **Step 3:** Run `node --test "test/*.test.mjs"`. Expected: every test passes. Put the new count in the README.
- [ ] **Step 4:** Release as NOTES.md describes: copy `next\src`, `next\test` and `README.md` over the live folder, then run `node src\install.mjs --no-open`. The hidden server restarts itself and open pages reload at the new level.
- [ ] **Step 5:** Open the live page from its icon. Expected: five tabs, key `5` opens Night shift, and until the conveyor's first tick it reads "Night shift is not set up yet." Check that a request with no key still gets 403. Send Blake the `ok` still and the live "not set up" still.
