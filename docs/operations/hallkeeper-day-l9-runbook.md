# The hallkeeper's day on production: what a local session runs (Plan 19 L9)

Written 28 October 2026 by the cloud hallkeeper session for the local session that runs it once
**the hallkeeper is invited and has signed in once** and **Blake has set VAPID**. It covers what
code alone cannot prove for goals 05 and 19: the three-identity S9 run, ring latency on
production, the wall night, phone and iPad numbers, and the usability run. The walk itself is
[living-timetable-rehearsal.md](living-timetable-rehearsal.md); this page adds the instruments,
the exact commands, the order, and where every number goes.

Agents may not sign in through Clerk. Every signed-in step below is a person's hands (Blake's,
the hallkeeper's, Elaine's); the local session opens the windows, runs the instruments, watches
the logs and writes the record. Nothing here changes a booking time, a layout or stock.

## 0. Before anything: what must be true

| Check | How | Who |
|---|---|---|
| PRs #296 (offline request steps), #297 (sheet and print, one release), #298 (crowded day) and this one merged and deployed | `curl -s https://api.venviewer.com/health/version` shows the merge sha; `curl -s https://api.venviewer.com/health/ready` is ready | local session |
| VAPID set on the API | Railway variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a real `mailto:`), then a restart ([push-alerts.md](push-alerts.md)). Signed in on the Day Board, **Turn on alerts on this device** must not say "Alerts are not switched on for this venue yet" | Blake sets; local session checks |
| The hallkeeper account | invited through the venue team page, signed in once on their phone; role hallkeeper, venue Trades Hall | Blake |
| A client account with a test event, and the office account | the client holds the event's link; the office is admin or staff | Blake |
| A second hallkeeper, or the office on a phone | for the double accept | Blake |
| The floor is told | test requests ring every connected staff screen and push to subscribed phones; say so in the team chat first | Blake |
| Test ink | one booking **today**, titled exactly `VENVIEWER TEST — delete`, on the client's test event, in a room nobody is using | Blake inks it on `/diary` |

Note the event id (the client's page is `/events/<eventId>`) and the booking's room.

## 1. Ring latency on production (D12: ≤ 1,500 ms p95, measured)

On the local session's PC (a desktop, mains, one clock for both windows):

```bash
EVENT_ID=<the client's test event id> N=10 OUT=ring-latency-$(date +%Y%m%d-%H%M).json node packages/web/scripts/ring-latency-live.mjs
```

Two Chromium windows open, each with its own profile in `~/.venviewer-ring-latency`. Blake signs
in **as the hallkeeper** in the first (it waits on `/hallkeeper/today` for the board) and **as the
client** in the second (it waits on the event page for "Ask for something"). The profiles keep the
sign-ins for the next run. Then, ten times, the client asks for chairs through their own composer
("When you can", tagged `VENVIEWER TEST ring <run> — delete`). The hallkeeper's window stamps the
first paint of each request on the board, and the report gives every sample, p50, p95 and the
misses. Afterwards the hallkeeper's window finishes each test request "Not needed" (`KEEP=1`
leaves them).

Record in [docs/reports/living-timetable-2026-10.md](../reports/living-timetable-2026-10.md)
section 3: "Ring after send, production: p50 … ms, p95 … ms, n = 10, misses …; measured, venviewer.com,
Chromium <version> on <machine>, one machine clock". At the same time, read the Railway API logs
for `conversation.fanout` lines (`screens`, `latencyMs`) and note the connection counts from
`diary-live.connections`. A miss is a finding: record it, do not rerun until it passes.

The instrument itself was rehearsed with `DRY_RUN=1` against a mocked API and socket (5 of 5
rings, clean-up done); a dry run's numbers measure nothing but the instrument.

## 2. The three-identity walk (goal 19 S9)

Run [living-timetable-rehearsal.md](living-timetable-rehearsal.md) section 2, steps 1 to 15, with
these changes now that #296 and #297 are live:

- **Step 4:** the stopwatch is replaced by section 1's number. Still note by eye that the ring is
  on the **wall** too.
- **Step 12, the disconnected phone (#296):**
  1. Put the hallkeeper's phone in flight mode and press **Seen** on a test request. The card
     says "Waiting to send: Seen".
  2. Press **I'll do it**. The card says "Waiting to send: Seen · I'll do it", and the card still
     names nobody as owner.
  3. Turn flight mode off. Within seconds the waiting line clears and the card names the hallkeeper.
  4. On the office's `/diary`, the request's history shows Seen once and accepted once.
- **Step 12b, the conflict (#296):**
  1. With the phone in flight mode again, press **I'll do it** on a new test request.
  2. Meanwhile the second hallkeeper takes it.
  3. Turn flight mode off. The phone's slot says "Your "I'll do it" on Chairs × … was not sent.
     <name> has this." The owner stays the second hallkeeper.
- **Step 14b, sheet and print (#297):**
  1. On `/hallkeeper/<the test layout's configuration id>`, download the PDF and print it.
  2. The office approves a new version of that layout.
  3. Scan the printed QR: it says superseded, with the new version in force.
  4. The phone left open on the old sheet shows **Superseded** within two minutes. **Open v…**
     loads the new one.

Stop conditions are the rehearsal's section 4. Clean up as its step 15 says, and check with
`/hallkeeper/today` that no `VENVIEWER TEST` slab or request is left.

## 3. The wall night

Two checks run together the same night: the tablet on the wall (by eye) and the watcher (by
machine).

1. **The tablet.** Set it up as [hallkeeper-wall-display.md](hallkeeper-wall-display.md) says: on
   `/hallkeeper/today?register=wall`, on mains, with Guided Access (iPad) or screen pinning
   (Android). Leave it from the evening until after 07:00.
2. **The watcher.** On the local session's PC, also on mains, with sleep switched off:

   ```bash
   HOURS=14 EVERY_MINUTES=5 node packages/web/scripts/wall-night-watch.mjs
   ```

   Blake signs in as the hallkeeper in the window that opens (the same profile folder as section
   1, so one sign-in may serve both). The watcher leaves the page alone. It writes
   `wall-night-<date>/readings.jsonl` every 5 minutes, a screenshot every hour, and
   `summary.json` in the morning. The summary covers: the days the board showed, whether it
   rolled to the new day, the longest stale stretch, whether it is still on the board (signed
   in), memory first, last and highest, and every page error.
3. **In the morning**, by eye on the tablet, after 04:00 venue time:
   - the board shows today;
   - the screen is lit;
   - the live dot breathes;
   - "Updated" is within the last few minutes;
   - there is no slate band.

   Photograph it. Record both in the report's section 2 row "The wall display survives the
   night": measured, with the tablet's model and OS, and the watcher's summary attached. Name the
   watcher as desktop Chromium; it is not the tablet.

## 4. Phone and iPad numbers (D12: frame-interval p95 ≤ 16.7 ms, labelled measured)

`splat-drag-budget.mjs` drives the room walk and takes no `--route`. For the Day Board on a real
device, use the device's own inspector:

1. On the device, sign in as the hallkeeper and open `/hallkeeper/today` on the busiest day you
   can get. Production's real day is best; say how many lanes, slots and open requests it showed.
2. Attach the inspector:
   - **Android Chrome:** USB debugging on; on the PC open `chrome://inspect`, then **inspect**.
   - **iPad/iPhone Safari:** Settings → Safari → Advanced → Web Inspector on; on a Mac,
     Safari → Develop → <device> → the page.
3. Paste this into the console, keep your hands off for 30 seconds, then copy the line it prints:

   ```js
   (() => { const gaps = []; let last = performance.now(); const end = last + 30_000; const tick = (t) => { gaps.push(t - last); last = t; if (t < end) { requestAnimationFrame(tick); return; } gaps.sort((a, b) => a - b); const q = (p) => gaps[Math.min(gaps.length - 1, Math.ceil(p * gaps.length) - 1)].toFixed(1); console.log(JSON.stringify({ frames: gaps.length, p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: gaps[gaps.length - 1].toFixed(1), slabs: document.querySelectorAll(".dayboard-slab").length, ua: navigator.userAgent })); }; requestAnimationFrame(tick); })();
   ```

4. Repeat three times on each device:
   - idle;
   - while scrolling the board;
   - with a slot open.

The snippet was checked in Chromium (178 frames in 3 s, p95 16.8 ms on this container's
headless Chromium; that number is not a device number). Record each in the report's section 3
with the device's model and OS, labelled **measured**. The 16.7 ms line loses the word
"emulated" only for the devices measured.

For a guaranteed-dense day on a device, the crowded-day fixture (#298) can be written to the local
stack with `packages/api/src/scripts/seed-crowded-day-local.ts`, and a device on the same network
can browse the local stack. Say which day was measured.

## 5. The usability run (HUMAN.md 1)

Run [living-timetable-rehearsal.md](living-timetable-rehearsal.md) section 5 with Elaine and a
working hallkeeper, after sections 1 and 2 are clean, on a real upcoming event. The two measures
are:

- the next action found within five seconds;
- a request acknowledged within fifteen seconds.

Fill one row per attempt:

| # | Person | Device | Measure | Request kind | Seconds | Hit? | What they expected / what the screen showed |
|---|---|---|---|---|---|---|---|

Report n, hits, misses and every failure in its own words in the report's section 2, last row.
Never write a population claim.

## 6. After it: the record

- **The report:** section 3 gets every number above with its label. Section 2's rows move from
  "not run" to measured with n.
- **The session log for the day:** what ran, the deployed sha, every number, every miss, and what
  is still open.
- **docs/state/tasks.md, T-651:** one sentence with the date and links.
- If anything failed, open the fix as its own PR, citing the step and the reading.
