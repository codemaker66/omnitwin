**Read this when:** building or reviewing turnaround rules, the staff rota, or automatic changeover estimates (T-637).

# Turnarounds and the rota — design record, 26 September 2026 (T-637)

## What Blake asked

> "Allow staff to set the time it will take but i want you to plan the best way how we can make it automatic, and it will also depend on how much staff is available so we will need staff rota also to be part of our platform which you will need to construct now too and anything else we may of missed to be the most amazing venue and events business platform ever"

Three outcomes follow, in this order: staff set the time a changeover takes; a rota that says who is on; and estimates that work the time out from the work and the crew, which staff can always overrule. "Anything else we may have missed" is T-638 ([research/completeness.md](research/completeness.md)).

## What exists today

From [research/turnarounds.md](research/turnarounds.md) §1 and [research/rota.md](research/rota.md) §5:
- Turnaround rules exist in the database and drive the Diary's gap labels, the When ribbon and the Day Board, but **there is no screen or API to edit them**. The rules in use are demo values from the seed, and production holds them unmarked.
- The hallkeeper sheet ignores the rules (a fixed 90-minute buffer) and assumes an 18:00 start in UTC, so in summer it shows 19:00.
- The Day Board's "Changeover at risk" state can never fire.
- No record of real changeover times exists between bookings, and there is no rota or crew data anywhere.

## The experience

The measure is Blake's principle: make everyone's life easier. A veteran booker should see at a glance whether a room can be turned, without arithmetic, and never be told a number the platform cannot justify.

- **In the Diary**, each gap between two confirmed functions in a room says how long it has ("2 h 30 to turn"). Once a rule applies it says whether that is enough, quietly when it is and in copper when it is not. The words are the booker's own: never "insufficient_turnaround".
- **Selecting a gap** opens a small sheet beside the room's lane: the rule that applies, who set it and when, editable in place. Later the same sheet shows the estimate, the crew on shift and a one-line reason ("12 rounds and 120 chairs out, a stage in; 5 on shift").
- **Venue settings** list the rules per room in a calm table. Demo rules read "Not confirmed" until a person saves them.
- **The rota** looks like the Diary, because staff already read the Diary: people down the side, days across, and the week's functions along the top with the crew each needs. An unfilled need shows in copper; a filled week reads "All shifts filled". Publishing sends each person one digest of their week.
- **On the Day Board**, the crew on shift appears beside each changeover. Later, "Start changeover" and "Room ready" become two taps.

## The model

The full model and its evidence are in [research/turnarounds.md](research/turnarounds.md) §3. In short:
1. The staff-set rule is the planning figure.
2. The estimate sits beside it and replaces it only where no rule exists.
3. With neither, the gap says "not checked".

The estimate is a pure function: fixed allowances, plus the work in crew-minutes divided by the crew (capped for the room), scaled by a room factor learned from real changeovers. Staff enter every rate in their own terms. The platform ships no built-in minutes, because none could be sourced. Rules never change by themselves; the platform only suggests.

## Slices

| Slice | What ships | Depends on |
| --- | --- | --- |
| **A. Staff set the rules** | The rules API with tenancy and role tests. A migration: `confirmed_at`, `updated_by`, a uniqueness rule asserted before it is added, and room-belongs-to-venue checks. The rules panel in Venue settings and from the Diary gap. Demo rules shown as not confirmed. The sheet's "set up by" from the applicable rule. | Lane 6, which takes the sheet's times from the Diary booking in the venue's zone and so fixes the summer-hour error |
| **B. Rota, version 1** | Staff records that need no login, with skills and the facts the law needs (an under-18's eighteenth birthday, right-to-work check, 48-hour opt-out). Shifts in draft and published states. The week view. Availability and leave. Working-time warnings in plain words: 11 hours' rest, the 20-minute break over 6 hours, 24 hours off in 7, and a rolling 48-hour average. Hard blocks are only the two legal ones: under-18s between midnight and 04:00, and children after 19:00. Publishing, with one digest per person and every late change recorded with the notice given. | A for the room list |
| **C. Demand from the Diary** | Editable staffing ratios by role and service style. Needs per function phase for Confirmed functions only; Provisional and option holds show as likely demand, with no shifts offered. Lines for crew the caterer supplies. | B |
| **D. Estimates** | Item rates, a room profile (fixed allowances, crew cap, floor) and the estimator with its explanation. The Diary shows rule, estimate and fit ("fits with 6"). The warnings `turnaround_exceeds_crew` and `crew_not_rostered`. | A, B |
| **E. Learning** | Changeover capture on the Day Board (device time, offline queue, confirmed crew). A room factor with a range and rule suggestions. The timeline's staffing figure filled from the rota. | D |
| Later | Shift offers to casual staff through a signed link; timesheets with a payroll CSV (holiday pay on its own line); swaps; SMS. | B |

**Status, 26 September:**
- Slice A's migration (0076) and API are built.
- So is the Changeovers section in Venue settings.
- Still to come in slice A: opening a rule from a Diary gap (after Lane 5), and the sheet's set-up time
  from the rule (after Lane 6).

Every slice follows the shipping contract. A migration ships **before** the code that reads it: Railway and Vercel deploy on push, and the Deploy workflow migrates only after CI. The migration takes the next free number; Lane 9's request model was earmarked 0076. Its journal `when` must be later than the last applied one, because drizzle silently skips an older timestamp.

## Defaults chosen, which Blake may overrule

- **Who edits turnaround rules:** admin, manager and staff, the roles that administer the venue. Hallkeepers read the rules and, from slice E, see suggestions they can pass on. This keeps both "allow staff to set the time" and decision 6b, which keeps hallkeepers out of venue administration.
- **Who manages the rota:** admin, manager and staff. Everyone on it sees their own shifts and the published week. Version 1 holds no pay rates.
- **The rota's scope:** the Hall's own team, by name. Crew the caterer supplies appear as headcount lines.
- **Notice:** publishing four weeks ahead is encouraged (the Living Hours standard). A change inside 7 days is flagged and recorded with the notice given, ready for the 2027 rules.
- **Notifications:** in-app, plus one daily email digest. Changes inside 48 hours are sent at once. No SMS until a provider is chosen.
- **Never:** timing individuals, leaderboards, countdowns, GPS or fingerprints, or inferring paid hours from phone activity.

## Questions for Blake

1. Which roles does the Hall employ itself, and which do the caterers supply (waiting, bar, event management)? The answer sets the rota's scope; the default above applies until then.
2. Which payroll system does the Hall use? This matters only for the timesheet export, which comes later.
3. How are casual staff contacted today? Email and in-app is the default; SMS needs a provider and has a running cost.
