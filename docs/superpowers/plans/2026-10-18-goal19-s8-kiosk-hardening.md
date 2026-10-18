# Goal 19 S8: Kiosk and Phone Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A wall tablet or a hallkeeper's phone left on the Day Board for a whole shift keeps telling the truth: the day rolls at the venue's own boundary hour, the screen stays awake, nothing burns in, the socket re-authenticates with a fresh token, and when the display dies the day prints.

**Architecture:** Three small pure modules under `packages/web/src/pages/hallkeeper/lib/` (board day, wake lock, burn-in drift) and one print stylesheet block, each wired into `DayBoardPage.tsx` with one line, so the page stays the composition and the rules stay unit-testable. The board's existing one-tick clock (`use-board-clock.ts`) learns one more boundary: the day rollover. The venue's day boundary comes from S7's operating settings (`GET /venues/:id/operating-settings`, `dayBoundaryHour`), read once by the page, midnight without a row.

**Tech Stack:** React 18, Vitest + Testing Library (happy-dom), existing `board-time.ts` wall-clock helpers (Europe/London through `VENUE_TIME_ZONE`), the Screen Wake Lock API, CSS `@media print`.

**Spec:** `goals/19-the-living-timetable.md` S8 (line 193) and numbered items 13, 14, 15; `docs/operations/people-matrix.md` §6 (`day_boundary_hour`, default 4). Branch `claude/living-timetable-s8-kiosk` from `6ba3aafa` (S7's tip); S7's `getOperatingSettings` in `packages/web/src/api/operating-settings.ts` is already on it.

## Global Constraints

- TypeScript strict, no `any`, no `as unknown as`; Zod at every boundary; pnpm; Vitest.
- All visible loading and working states use `components/shared/Activity.tsx`; none are added here.
- Spring, not tween, for any object motion; the burn-in drift is a position, not a motion, and moves once per period with no transition.
- No new Playwright spec: every new e2e case needs the browser release gate's inventory admission. The S8 stale-band e2e the spec names is therefore recorded as a follow-up, not added.
- Wall register is `?register=wall` on `/hallkeeper/today`; nothing opens on the wall (D11); the wall shows no controls.
- Day boundary: `dayBoundaryHour` from operating settings, `0..23`; without a settings row the board rolls at midnight, as today.
- Venue time is Europe/London via `board-time.ts`; never `Date#getHours`.
- Copy in the house register: plain sentences, no praise, no exclamation marks.

## Review Focus

1. 03:59 on a wall left on since yesterday: the board still shows yesterday's day (an event running to 02:00 is today's), and at 04:00:00 it shows the new day with one redraw. Pinned in Task 1's 26-hour test.
2. DST Sunday with the boundary at 04:00: the rollover lands on the wall clock's 04:00, not 04:00 UTC plus an offset. Pinned in Task 1 (both Sundays).
3. A browser without `navigator.wakeLock` (Firefox, an old Android WebView): the board runs, no lock, no error. Pinned in Task 2.
4. The tab is hidden then shown (the tablet's screen slept despite the lock, or the hallkeeper switched apps): the lock is requested again on `visibilitychange`. Pinned in Task 2.
5. The socket drops at 03:00 with a token that expired at 02:00: the reconnect asks the token getter again rather than resending the old frame, and an unavailable token closes the socket and backs off instead of looping. Pinned in Task 4.

---

### Task 1: The board's day rolls at the venue's boundary hour

**Files:**
- Create: `packages/web/src/pages/hallkeeper/lib/board-day.ts`
- Test: `packages/web/src/pages/hallkeeper/lib/__tests__/board-day.test.ts`
- Modify: `packages/web/src/pages/hallkeeper/DayBoardPage.tsx:836-840` (today's anchor) and `:829` (clock boundary)
- Modify: `packages/web/src/pages/hallkeeper/__tests__/DayBoardPage.test.tsx` (stub `../../../api/operating-settings.js` as the Diary tests do)

**Interfaces:**
- Consumes: `msToWallInput(ms, timeZone): string` ("YYYY-MM-DDTHH:MM"), `wallInputToMs(input, timeZone): number | null`, `VENUE_TIME_ZONE` from `pages/diary/lib/board-time.ts`; `nextTickMs(nowMs, nextBoundaryMs)` and `useBoardClock(nextBoundaryMs)` from `lib/use-board-clock.ts`; `getOperatingSettings(venueId): Promise<VenueOperatingSettings>` from `api/operating-settings.ts`.
- Produces: `boardDayAnchorMs(nowMs: number, dayBoundaryHour: number, timeZone?: string): number` (an instant at 12:00 wall time on the day the board shows); `nextBoardRolloverMs(nowMs: number, dayBoundaryHour: number, timeZone?: string): number` (the next instant the wall clock reads `dayBoundaryHour:00`, strictly after `nowMs`); `soonerOf(a: number | null, b: number): number`; `useDayBoundaryHour(venueId: string | null): number` (0 until settings arrive or when the venue has none).

- [x] **Step 1: Write the failing tests**

```ts
describe("the board's day", () => {
  it("before the boundary hour the board still shows yesterday", () => {
    // 03:59 London on 21 Jan 2026 = 03:59Z
    const anchor = boardDayAnchorMs(Date.parse("2026-01-21T03:59:00.000Z"), 4);
    expect(msToWallInput(anchor).slice(0, 10)).toBe("2026-01-20");
    expect(msToWallInput(boardDayAnchorMs(Date.parse("2026-01-21T04:00:00.000Z"), 4)).slice(0, 10)).toBe("2026-01-21");
  });
  it("boundary 0 is midnight, as the board rolled before S8", () => {
    expect(msToWallInput(boardDayAnchorMs(Date.parse("2026-01-21T00:00:00.000Z"), 0)).slice(0, 10)).toBe("2026-01-21");
    expect(msToWallInput(boardDayAnchorMs(Date.parse("2026-01-20T23:59:59.000Z"), 0)).slice(0, 10)).toBe("2026-01-20");
  });
  it("the next rollover is the wall clock's next 04:00, across both DST Sundays", () => {
    // 29 Mar 2026: clocks go forward at 01:00Z; 04:00 BST = 03:00Z
    expect(nextBoardRolloverMs(Date.parse("2026-03-28T12:00:00.000Z"), 4)).toBe(Date.parse("2026-03-29T03:00:00.000Z"));
    // 25 Oct 2026: clocks go back at 01:00Z; 04:00 GMT = 04:00Z
    expect(nextBoardRolloverMs(Date.parse("2026-10-24T12:00:00.000Z"), 4)).toBe(Date.parse("2026-10-25T04:00:00.000Z"));
    // exactly at the boundary the next one is tomorrow's
    expect(nextBoardRolloverMs(Date.parse("2026-01-21T04:00:00.000Z"), 4)).toBe(Date.parse("2026-01-22T04:00:00.000Z"));
  });
  it("soonerOf takes the earlier instant and tolerates no slot boundary", () => {
    expect(soonerOf(null, 10)).toBe(10);
    expect(soonerOf(5, 10)).toBe(5);
    expect(soonerOf(20, 10)).toBe(10);
  });
  it("a 26-hour wall shift: one rollover, at 04:00, and no tick finer than the minute between boundaries", () => {
    let now = Date.parse("2026-01-20T15:00:00.000Z");
    const end = now + 26 * 3_600_000;
    const days: string[] = [];
    let ticks = 0;
    while (now < end) {
      const day = msToWallInput(boardDayAnchorMs(now, 4)).slice(0, 10);
      if (days[days.length - 1] !== day) days.push(day);
      now = nextTickMs(now, nextBoardRolloverMs(now, 4));
      ticks += 1;
    }
    expect(days).toEqual(["2026-01-20", "2026-01-21"]);
    expect(ticks).toBeLessThanOrEqual(26 * 60 + 1);
    expect(msToWallInput(boardDayAnchorMs(Date.parse("2026-01-21T03:59:59.999Z"), 4)).slice(0, 10)).toBe("2026-01-20");
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @omnitwin/web exec vitest run src/pages/hallkeeper/lib/__tests__/board-day.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `board-day.ts`**

`boardDayAnchorMs`: read the wall clock with `msToWallInput`; if its hour is below `dayBoundaryHour`, the board's day is the previous wall date; return `wallInputToMs("<date>T12:00", timeZone)` (12:00 avoids the DST gap hour). `nextBoardRolloverMs`: `wallInputToMs` of today's `<date>T<HH>:00` where HH is the boundary; if that is `<= nowMs`, tomorrow's. Dates step by parsing the wall date and adding one day through `Date.UTC`, never by adding 86,400,000 ms to the instant. `useDayBoundaryHour(venueId)`: `useState(0)`; `useEffect` calls `getOperatingSettings(venueId)` once per venue, `.then((s) => setHour(s.dayBoundaryHour)).catch(() => undefined)` (a 404 or a venue without a row leaves 0).

- [x] **Step 4: Wire the page**

In `DayBoardPage.tsx`: `const dayBoundaryHour = useDayBoundaryHour(venueId);` and `const selectedMs = selectedDate === null ? boardDayAnchorMs(nowMs, dayBoundaryHour, timeZone) : wallInputToMs(...) ?? nowMs;`. The clock boundary becomes the earlier of the slot boundary and the rollover: `useBoardClock(soonerOf(boundaryMs, nextBoardRolloverMs(nowMs, dayBoundaryHour, timeZone)))` — `nowMs` here is the previous tick's reading, which is what the clock wants. Replace the "rolls to the new day by itself" comment with the boundary-hour sentence. Stub the settings module in `DayBoardPage.test.tsx` the way `DiaryBoardPage.test.tsx` does (`vi.mock("../../../api/operating-settings.js", ...)` returning `OPERATING_SETTINGS_DEFAULTS`).

- [x] **Step 5: Run** `pnpm --filter @omnitwin/web exec vitest run src/pages/hallkeeper` → PASS.

- [x] **Step 6: Commit** `git add packages/web/src/pages/hallkeeper/lib/board-day.ts packages/web/src/pages/hallkeeper/lib/__tests__/board-day.test.ts packages/web/src/pages/hallkeeper/DayBoardPage.tsx packages/web/src/pages/hallkeeper/__tests__/DayBoardPage.test.tsx` — "The Day Board's day rolls at the venue's boundary hour".

### Task 2: The wall stays awake

**Files:**
- Create: `packages/web/src/pages/hallkeeper/lib/use-wake-lock.ts`
- Test: `packages/web/src/pages/hallkeeper/lib/__tests__/use-wake-lock.test.tsx`
- Modify: `packages/web/src/pages/hallkeeper/DayBoardPage.tsx` (one call beside `useDiaryLive`)

**Interfaces:**
- Produces: `interface WakeLockSentinelLike { release(): Promise<void>; readonly released: boolean }`, `interface WakeLockSurface { request(type: "screen"): Promise<WakeLockSentinelLike> }`, `useWakeLock(active: boolean, surface?: WakeLockSurface | null): void` (surface defaults to `navigator.wakeLock` where it exists, else null).

- [x] **Step 1: Write the failing tests** (`renderHook` from Testing Library; a fake surface recording `request` calls and returning a sentinel whose `release` resolves):
  - "requests the screen lock when active and releases it when not": render with `active: true` → one request; rerender `active: false` → the sentinel released.
  - "asks again when the tab is shown after being hidden": set `document.visibilityState` via `Object.defineProperty` to "hidden" then "visible" and dispatch `visibilitychange` → a second request.
  - "a browser without the API does nothing and throws nothing": `surface: null` → no error; a surface whose `request` rejects (the page is not visible, or the battery is low) → no unhandled rejection, exactly one call.
- [x] **Step 2: Run** `... vitest run src/pages/hallkeeper/lib/__tests__/use-wake-lock.test.tsx` → FAIL.
- [x] **Step 3: Implement** the hook: `useEffect` on `[active, surface]`; request, keep the sentinel in a ref, release on cleanup; a `visibilitychange` listener re-requests when `document.visibilityState === "visible"` and the sentinel is null or released; every rejection is caught and dropped.
- [x] **Step 4: Wire** `useWakeLock(wall)` in `DayBoardPage.tsx` after `const device = ...` with the comment "The wall never sleeps (S8 item 14); phones and desks keep the system's own rule."
- [x] **Step 5: Run** the hallkeeper suites → PASS. **Step 6: Commit** — "Keep the wall display awake with the Screen Wake Lock".

### Task 3: Nothing burns in

**Files:**
- Create: `packages/web/src/pages/hallkeeper/lib/burn-in-drift.ts`
- Test: `packages/web/src/pages/hallkeeper/lib/__tests__/burn-in-drift.test.ts`
- Modify: `packages/web/src/pages/hallkeeper/DayBoardPage.tsx:985-992` (root `style`), `packages/web/src/pages/hallkeeper/day-board.css` (wall register rule)

**Interfaces:**
- Produces: `DRIFT_PERIOD_MS = 10 * 60_000`, `DRIFT_STEP_PX = 3`, `driftOffset(nowMs: number): { readonly x: number; readonly y: number }` — one of nine positions on a 3×3 grid of `DRIFT_STEP_PX`, chosen by `Math.floor(nowMs / DRIFT_PERIOD_MS) % 9` in a fixed order that never repeats a neighbour twice in a row.

- [x] **Step 1: Write the failing tests**: every offset within ±3 px on both axes; two instants 10 minutes apart give different offsets; two instants in the same period give the same; over 90 minutes all nine positions appear once.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement** with a literal nine-entry order such as centre, N, SE, W, NE, S, NW, E, SW.
- [x] **Step 4: Wire**: in `DayBoardPage.tsx` compute `const drift = wall ? driftOffset(nowMs) : null;` (nowMs already ticks at least every minute, so the shift lands within a minute of the period edge) and set on the root `style` the two custom properties `--lt-drift-x` and `--lt-drift-y` in px, declared through a typed `DriftStyle extends CSSProperties` interface rather than a cast. In `day-board.css`, under `.dayboard[data-register="wall"]`: `translate: var(--lt-drift-x, 0) var(--lt-drift-y, 0);` with no transition.
- [x] **Step 5: Run** the hallkeeper suites → PASS. **Step 6: Commit** — "Drift the wall display a few pixels every ten minutes against burn-in".

### Task 4: The socket re-authenticates with a fresh token

**Files:**
- Create: `packages/web/src/pages/diary/hooks/__tests__/useDiaryLive.test.tsx`
- Modify: `packages/web/src/pages/diary/hooks/useDiaryLive.ts` only if the test fails.

**Interfaces:**
- Consumes: `useDiaryLive(enabled, refetch, { device })`, `setTokenGetter` from `api/auth-bridge.ts`, `nextBackoffMs`.

- [x] **Step 1: Write the failing test** with a fake `WebSocket` class installed on `globalThis` (records instances, `send` payloads, lets the test fire `onopen` and `onclose`): the token getter resolves "t1" then "t2"; the first socket opens and receives `{type:"auth", token:"t1", device:"wall"}`; close it; advance fake timers past `nextBackoffMs(0)`; the second socket's auth frame carries "t2", and the getter was called twice. Second case: the getter resolves null on reconnect → the socket is closed by the hook and no auth frame is sent.
- [x] **Step 2: Run** `... vitest run src/pages/diary/hooks/__tests__/useDiaryLive.test.tsx`. Expected: PASS if the hook already behaves so (it calls `getAuthToken()` in every `onopen`); if it fails, fix the hook minimally and rerun.
- [x] **Step 3: Commit** — "Prove the live socket asks for a fresh token on every reconnect".

### Task 5: When the display dies, the day prints

**Files:**
- Modify: `packages/web/src/pages/hallkeeper/DayBoardPage.tsx` (header controls, paper register only), `packages/web/src/pages/hallkeeper/day-board.css` (`@media print` block), `packages/web/src/pages/hallkeeper/__tests__/DayBoardPage.test.tsx`

**Interfaces:**
- Produces: `BOARD_PRINT_COPY = { print: "Print today", note: "Printed from the Day Board; the screen is the record." }` exported from `DayBoardPage.tsx` beside the existing copy constants.

- [x] **Step 1: Write the failing tests** in `DayBoardPage.test.tsx`: the paper register shows a button "Print today" which calls `window.print` (stub it with `vi.fn()`); the wall register (`?register=wall`) shows no such button.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement**: a plain `<button type="button" className="dayboard-print">` in the header's control group, hidden when `wall`; `onClick={() => { window.print(); }}`. In `day-board.css` add `@media print { ... }`: hide `.dayboard-print`, the day controls, the request ring, the chime and alerts switches and the shift handover; lanes stack vertically with each slab showing room, title, time range and state words in black on white; a `<p className="dayboard-print-note">` always rendered and shown only in print carries `BOARD_PRINT_COPY.note` and the printed date.
- [x] **Step 4: Run** the hallkeeper suites → PASS; the print layout is checked by eye in Task 6's browser check (no new spec).
- [x] **Step 5: Commit** — "Print today from the Day Board when the display dies".

### Task 6: The wall display note, the browser check and the records

**Files:**
- Create: `docs/operations/hallkeeper-wall-display.md`
- Modify: `docs/sessions/2026-10-18.md`, `docs/state/tasks.md` (T-651 row), `goals/EXECUTION.md` (S8 row), this plan (tick boxes)

- [x] **Step 1: Write the note**: sections "The wall URL" (`/hallkeeper/today?register=wall`, signed in as the house's wall account, nothing opens on it), "Keeping it on" (Wake Lock holds while the page is visible; iPad: Settings → Accessibility → Guided Access, triple-click to start, disable touch; Android: screen pinning; Chrome kiosk `--kiosk` on a PC), "The day boundary" (04:00 by default from operating settings; an event to 02:00 stays on today's board), "Burn-in" (the board shifts three pixels every ten minutes; OLED still wants a nightly off), "When it dies" (the stale band's words; the office prints today from the paper register; the phone is the second screen), "Signing in" (Clerk refreshes the session while the tab is open; after a reboot sign in once).
- [x] **Step 2: Browser check on the local stack** (recipe in `D:/claude/s7-check/`): open the wall register with the venue's `dayBoundaryHour` set to 4 and the browser clock at 03:58 London via Playwright `page.clock.install({ time })`; screenshot; advance to 04:00; screenshot showing the new day; `page.emulateMedia({ media: "print" })` on the paper register and screenshot; record whether the wall requested the lock through a `page.evaluate` probe of `navigator.wakeLock`, and the `translate` value read from `getComputedStyle` at two simulated periods. Save under `D:/claude/s8-check/evidence/`.
- [x] **Step 3: Records**: session log entry; T-651 row gains "S8 kiosk hardening: PR #<n>"; EXECUTION S8 row filled; follow-up noted: the stale-band e2e awaits inventory admission.
- [x] **Step 4: Commit** — "Record goal 19 S8 and the wall display note"; open the PR with the evidence table; request the deep-reviewer round.
