# The living timetable — delivery report, October 2026

Goal 19 ([goals/19-the-living-timetable.md](../../goals/19-the-living-timetable.md)), slices S0 to
S8, built 8 to 18 October 2026 and live on venviewer.com. This report says what is on production,
what was measured and where, and what the "Done when" sentence still waits for. Every line names
its evidence; a line without one is marked so. Nothing here is a demonstrated journey on
production with real people unless it says so, and none is yet: that is S9's run with Elaine,
HUMAN.md item 1.

## 1. What is live, by slice

| Slice | On master | Live | Checked where |
|---|---|---|---|
| S0 Ground, S1 Contracts, S2 Transport | 0586ab03 (PR #56), 9 Oct | web on Vercel 02:35 UTC, API on Railway 02:37, migration 0087 | unit and Postgres suites on the disposable cluster |
| S3 The board, rebuilt | 0586ab03 | as above; the rebuilt Day Board chunk served | e2e 4/4, visual harness 28/28, screenshots on office, wall and phone |
| S4 Requests and conversations on the slot | 180edb5f (PR #62), ee931af0 (PR #64), 10 Oct | API on Railway 13:27 UTC | the three-identities e2e 4/4 on a live local stack |
| S5 Observations | 2e255070 (PR #67), 5ebe8688 (PR #74), migration 0088 | 10 and 14 Oct | types, API, web suites; observations 6/6 on the cluster |
| S6 The When | 91f53a1f (PR #92), migration 0089; the pricing window form 4b10a92a (PR #98) | 16 and 18 Oct; `/health/ready` 88 of 88 then | browser-verified as client and office on the S6 stack; the form's slot-only estimate on the local stack |
| S7 Beyond the glass | 574ab2ed (PR #127), migration 0092 at journal idx 90 | 18 Oct; Railway applied 0092 (ready 91 of 91) | local stack: escalation to the named duty admin, email deferred by quiet hours, handover, presence by device, the push worker; two review rounds |
| S8 Kiosk and phone hardening | fdf3aeb0 (PR #128) | 18 Oct; entry bundle carries fdf3aeb0 | local stack on a booked day: the print sheet, the bare wall, the day boundary, the drift; one review round |

Push is built and off: it waits for the three VAPID variables on the Railway API service (Blake's
hand-back in PR #127). Email escalation is on (RESEND_API_KEY and EMAIL_FROM are set).

## 2. The "Done when" sentence, clause by clause

| Clause | State | Evidence |
|---|---|---|
| A client proposes "Grand Hall, 12 to 4" from the planner; the office inks it; the price updates with the window | built and browser-verified locally (S6, #98) | docs/sessions/2026-10-16.md; D:/claude/pricing-window-check/evidence |
| The Day Board shows the slot green an hour before setup, amber half an hour before doors, red while live, on the corrected time | built (S3, S5); phase timings from the venue's buffers | DayBoardPage tests; the visual harness; D9 corrected clock |
| The client asks for ten more chairs and the copper ring is on the slot on the wall and on a phone within a second | **measured on a live local stack, not on production**: ring painted 358 ms after send (137 ms after the API answered); run 5: 211 ms / 138 ms | docs/sessions/2026-10-10.md 12:35 |
| Two hallkeepers tap accept and exactly one owns it | measured in the same run: one accept in the history, the loser's card names the owner | same |
| The client sees "Elaine has this" and then the outcome | measured: the client saw the owner on its first poll (13 ms) | same |
| A staff-private note never reaches the client; a revoked link is closed at once | measured: the note absent from the client's snapshot, the thread read 403; after the plan is deleted the next poll and request are 403 | same |
| The wall display survives the night | built (S8): the day rolls at the venue's boundary hour, the screen holds a wake lock, the board drifts one pixel a minute, the socket re-authenticates; a 26-hour simulated clock in a unit test | board-day, use-wake-lock, burn-in-drift and useDiaryLive tests; D:/claude/s8-check; **a real night on a real tablet not yet run** |
| A disconnected phone's acknowledgement reconciles on reconnect | built (S5's offline queue with ordered drain) | API observation tests; web queue tests |
| Nothing any message did changed a time, a layout or stock | by construction: requests and messages mutate no event, time, layout or stock (D4, Forbidden) | route tests; requests-postgres |
| The frame and latency numbers in D12 are met and labelled emulated or measured | /hallkeeper/today draws under the governor on this PC's RTX 4090 (emulated phone); **no phone or iPad measurement yet** (HUMAN.md 3) | project memory; goal 19 D12 |
| The usability targets are reported with n and every failure | **not run**: HUMAN.md 1 with Elaine and a working hallkeeper | this report, section 4 |

## 3. Numbers, with their labels

| Measure | Value | Label |
|---|---|---|
| Ring on the hallkeeper's slab after the client's send | 358 ms (run 6), 211 ms (run 5) | measured, live local stack, headless Chromium, this PC |
| Of which after the API answered | 137 ms, 138 ms | measured, same |
| Client's first sight of the owner | 13 ms after the accept | measured, same |
| Escalation windows | now 120 s, soon 300 s, routine 900 s; quiet hours 22:00 to 07:00 Europe/London | decided by Blake 10 Oct, seeded in 0092 |
| Local escalation rehearsal | soon window 30 s: inbox row and email_sends row within the next pass; handover relief 300 s | measured, local stack 18 Oct |
| Print sheet on a booked day | four slabs at 1,338 px, static, verb and time shown | measured, local stack, print media |
| Burn-in drift | one pixel a minute round a three-pixel ring | by construction (goal 19 line 132) |
| Day boundary | 04:00 by default; a 26-hour simulated shift rolls once, at 04:00 | unit test |

## 4. What S9 still owes, and who holds each piece

1. **The three identities on production.** Needs a hallkeeper account on production (goal 19 human
   input 3, in progress since 10 October) and signed-in sessions as client, office and hallkeeper.
   Agents may not sign in through Clerk, so this is Blake's walk with a session watching; the script
   is [docs/operations/living-timetable-rehearsal.md](../operations/living-timetable-rehearsal.md).
2. **Test ink titled "VENVIEWER TEST — delete".** Part of the same walk; the script says when to
   ink it and when to delete it.
3. **The run with Elaine and a working hallkeeper** (HUMAN.md 1): next action found in five
   seconds, a request acknowledged in fifteen; report n and every failure. The script's section 5
   is the scoring sheet.
4. **A night on a real tablet** for S8 (the wake lock and the rollover on the device, not in a
   test), and a phone and an iPad for a day so the frame lines lose the word "emulated" (HUMAN.md 3).
5. **Push on production**: the VAPID hand-back.

## 5. What is not built, by decision

The stale-band Playwright case the S8 slice names (every new e2e case needs the browser release
gate's inventory admission); the per-slot print link to the approved PDF (goal 19 line 132; each
slot's sheet prints from the slot detail); a screen for the operating settings (`dayBoundaryHour`
and the windows change through `PATCH /venues/:id/operating-settings`); a second API replica (D5
documents one).

## 6. Where the records are

- Session logs: docs/sessions/2026-10-08.md to 2026-10-18.md.
- The execution board: goals/EXECUTION.md.
- Plans: docs/superpowers/plans/2026-10-17-goal19-s7-beyond-the-glass.md and
  2026-10-18-goal19-s8-kiosk-hardening.md.
- Operations: docs/operations/push-alerts.md, docs/operations/hallkeeper-wall-display.md,
  docs/operations/people-matrix.md.
- Evidence on this PC: D:/claude/s7-check, D:/claude/s8-check, D:/claude/pricing-window-check.
