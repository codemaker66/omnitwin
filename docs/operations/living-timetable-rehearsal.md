# The living timetable: the rehearsal and the run

Goal 19 S9. Two walks on production, both signed in, both timed, both with a session watching the
API logs and the pages. Agents may not sign in through Clerk, so the hands are Blake's (and, for
the run, Elaine's and a working hallkeeper's); the watching session reads, records and reports.

The sentence being proved is goal 19's "Done when": a client proposes a window from the planner,
the office inks it and the price follows the window, the Day Board shows the slot in the right
colour on the corrected time, the client asks for ten more chairs and the copper ring is on the
wall and on a phone within a second, two hallkeepers tap and exactly one owns it, the client sees
who has it and then the outcome, a staff-private note never reaches the client, a revoked link is
closed at once, the wall survives the night, a disconnected phone's acknowledgement reconciles.

## 1. Before the walk

- **Three identities on production**: an office account (admin or staff), a hallkeeper account
  (goal 19 human input 3: invited and signed in once), and a client account with an event. A
  second hallkeeper (or the office account on a phone) for the double-accept step.
- **Three screens**: a tablet on the wall register (`/hallkeeper/today?register=wall`, the
  hallkeeper account), a phone on `/hallkeeper/today`, and the office on `/diary`. A fourth window
  for the client.
- **The watching session** has the API's Railway logs open (`diary-live.connections`,
  `request.landed`, `request.escalated`, `email.*`) and a stopwatch; it writes every time below.
- **The test ink** is titled exactly `VENVIEWER TEST — delete`, so it can be found and removed
  afterwards. Nothing else is inked, resolved or deleted during the walk.

## 2. The walk, step by step

Record each step as: clock time, who, what, what appeared where, seconds elapsed, and anything
that did not happen.

1. **The client proposes.** Signed in as the client, from the planner, propose "Grand Hall, 12 to
   4" for the test event. Watch: the Diary shows the hold with the proposed window.
2. **The office inks.** On `/diary`, confirm the window and ink it as `VENVIEWER TEST — delete`.
   Watch: the price on the estimate pays the slot that holds the window (a windowed rule prices only
   its slot); the Day Board (phone and wall) shows the slot within a few seconds.
3. **The colours on the corrected time.** On the wall, the slot's state follows the venue's
   buffers: green an hour before setup, amber half an hour before doors, red while live. If the
   test slot is in the past or the future, read the words on the slab and the ruler instead and say
   so.
4. **Ten more chairs.** As the client, on the event page, ask for ten more chairs on the live slot.
   Start the stopwatch on send. Watch: the copper ring on the slot on the wall and on the phone.
   Record the seconds to each; the target is within one second. (Local measure: 358 ms.)
5. **Two hands.** The hallkeeper on the phone and the second hallkeeper (or the office) press
   "I'll do it" as close to together as they can. Watch: exactly one owns it; the loser's card names
   the owner. Record who, and the words shown to the loser.
6. **The client sees.** On the client's page: "Elaine has this" (or whoever owns it), then, when the
   hallkeeper resolves it, the outcome. Record the seconds from accept to the client's line.
7. **The private note.** The office writes a staff-private note on the request's thread. The client
   refreshes: the note is not there. Record.
8. **Escalation.** Raise a second request as the client and let nobody take it. At the venue's
   window (soon: five minutes) the duty administrator's inbox shows "Still waiting", and an email
   leaves unless the walk is inside quiet hours (22:00 to 07:00), in which case the email waits for
   07:00. Record the inbox time; check the `email_sends` row through the watching session's logs.
9. **Handover.** The owning hallkeeper presses "Hand over my shift" on the phone and names the
   relief. Watch: each open request stays theirs until the relief takes one; an untaken one escalates
   after the relief window (five minutes). Record.
10. **Presence.** On `/diary`, the header reads "Wall display live · <name>'s phone live". Turn the
    phone's screen off for two minutes: the line drops the phone within about a minute and a half.
    Record.
11. **The wall overnight.** Leave the wall register on the tablet overnight on mains, Guided Access
    on (iPad) or screen pinning (Android), per docs/operations/hallkeeper-wall-display.md. In the
    morning: the board shows today (it rolled at 04:00 on the wall clock), the screen is still lit,
    the live dot is on. Record the morning's time and state.
12. **The disconnected phone.** Put the phone in flight mode, acknowledge a request on it, bring it
    back. Watch: the acknowledgement lands and the history shows it once. Record.
13. **The revoked link.** The office deletes the client's plan (or revokes the link). The client's
    next action is refused. Record.
14. **Print.** On the office's paper register, press "Print today": the sheet lists each booking on
    one line with its state and time, the read time, and the note. Keep the sheet.
15. **Clean up.** Delete `VENVIEWER TEST — delete` and resolve or delete the test requests. Confirm
    the Day Board and the Diary no longer show them.

## 3. What the watching session records from the logs

- `diary-live.connections` per venue as screens open and close.
- The landed-within-a-second measure per frame for step 4.
- `request.escalated` with `emailDeferred` for step 8, and the `email_sends` status (`sent` or
  `dev_mode`).
- Any 4xx or 5xx on the request, conversation, handover or operating-settings routes.

## 4. Stop conditions

Stop the walk and report if: a request or message changes a time, a layout or stock; the client
sees a staff-private note; two owners appear on one request; the wall shows a day that is not
today after 04:00; anything shows a delivered or seen state that did not happen.

## 5. The run with Elaine and a working hallkeeper (HUMAN.md item 1)

Sixty to ninety minutes, on an upcoming real event, after the walk is clean. Two measures, each
repeated, with n and every failure reported:

| Measure | Target | How it is timed |
|---|---|---|
| Next action found | five seconds | from the hallkeeper looking at the phone or the wall to saying what they will do next; the next-action line is the thing being judged |
| A request acknowledged | fifteen seconds | from the client's send (or the office's, raising it on their behalf) to the hallkeeper's acknowledge or accept on the phone |

Record per attempt: who, the request kind, the seconds, and whether it was a hit. Report
`n`, the hits, the misses, and every failure in its own words (what the person expected, what the
screen showed). A miss is data, not a fault in the person. The report goes into
docs/reports/living-timetable-2026-10.md, section 2's last row.
