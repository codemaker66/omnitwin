## Room turnarounds: what exists, what is known, and a model (T-637)

Research for Blake's third-round answer: staff set how long a changeover takes, and the platform plans how to estimate it automatically from the work involved and the staff on shift. Read-only; 26 September 2026, against the integration tree at `2be601ca`.

### How to read the evidence

The network proxy blocked every page fetch, so the outside figures below come from **search-engine summaries** of the cited pages. Most are guidance or vendor claims, not measurements. Nothing here is a sourced per-item timing, and the platform should not ship built-in per-item minutes.

### 1. What exists in the code

**Rules and the conflict engine**
- `turnaround_rules` (`packages/api/src/db/schema.ts`, migration `0050_diary_bookings.sql`) stores venue, optional room, optional event type, a name, minutes and an active flag. It has no (space, venue) composite key, no uniqueness rule, no `fixture_source`, no editor, no history, and no crew or layout dimension.
- `resolveTurnaroundRule` (`packages/api/src/services/calendar-conflicts.ts`) picks the most specific active rule by room and by the **incoming** event type; a tie goes to the larger minutes.
  - The engine merges each event's confirmed booking and room-scoped phases into one occupancy, checks consecutive **confirmed** occupancies only (holds are ignored), and raises `insufficient_turnaround` as a warning. Where no rule applies it reports `not_checked` or `partial`.
- The web copies the resolver (`packages/web/src/lib/turnaround-guidelines.ts`) for the Diary's gap labels ("under the 2h guideline", `aria-hidden`), the check line, the planner's When ribbon and the Day Board.
- The Day Board's red "Changeover at risk" fires only on `blocking`, which the engine never emits, so it cannot fire today.
- **There is no API and no screen to view or edit the rules.** The rules in use are the seed's demo values (90, 120, 180, 30 and 30 minutes, `packages/api/src/db/seed.ts`). `GOAL.md` records that they were written to production, where nothing marks them as demo data.
- **The hallkeeper sheet ignores the rules.** It uses a fixed `SETUP_BUFFER_MINUTES = 90` and an 18:00 start taken from the enquiry date (`packages/api/src/services/hallkeeper-sheet-v2-data.ts`).
- **A time-zone error in the sheet.** `T18:00:00.000Z` is 18:00 UTC. The web sheet formats times in the venue's zone, so it shows 19:00 during British Summer Time; the PDF's "Setup by" uses the server's zone.

**What a layout records**
- Placed objects link to asset definitions (name, category, size, seats). The catalogue includes 6ft rounds, 4ft and 6ft trestles, poseur and café tables, chairs, platforms, dance-floor panels, projector, screen, microphones, bar, servery, dividers, place settings and cloths.
- `generateManifestV2` builds rows by phase (structure, furniture, dress, technical, final) and zone. Grouped chairs fold into rows such as "6ft Round Table with 10 chairs", so an estimator should count placed objects by category, not parse row names.
- A booking with no event or layout has nothing to estimate from.

**What is recorded about real progress**
- Mission phases and tasks have `actualStartedAt` and `actualEndedAt`, and mission events are append-only. All use the server's clock; the offline queues keep the device time only on the device, so a tick that waited out a Wi-Fi drop gets the reconnect time.
- Checklist ticks cannot give durations: they are stored per layout, unticking deletes the row, and the time is the insert time.
- Mission phase spans are the closest thing to real changeover minutes, and they exist only for flips inside one event. **Changeovers between bookings leave no record.**
- Phase templates have `room-flip` and `breakdown` but no set-up key. The seed's "Setup" and "Teardown" phases sit inside the booked window, so a gap rule after an event that books its own teardown can count the same time twice.
- There is no rota and no crew data. The timeline's staffing figure is hard-wired to "not checked".

### 2. Outside evidence

| Figure | Source | Kind |
| --- | --- | --- |
| 150 guests at rounds: a crew of 3 takes 2.5–3.5 h with dollies, 4.5–5.5 h carrying chairs; dollies cut 30–40% | Probably superiorseating.com (a seating seller) | Guidance |
| 100 people: 2–3 professionals 60–90 min, volunteers 2–3 h | ChurchPlaza | Guidance |
| One set-up worker per 250–300 sq ft, plus 10–15% for rigging; a 25–30% buffer | eventstaff.com and other agencies | Guidance |
| Teardown: a quarter of set-up (one source); 20% more staff or an extra hour (another) | Various | No consensus |
| A 12×12 ft dance floor, 16 panels, two people, 15–20 min | Beyond Tent | Vendor claim |
| Overmanning cost 0–41% of productivity across 54 projects | [Hanna et al. 2007, ASCE JCEM 133(1)](https://ascelibrary.org/doi/abs/10.1061/(ASCE)0733-9364(2007)133:1(22)) | Measured, in construction |
| Reference class forecasting: past similar jobs correct optimistic bottom-up plans | [Flyvbjerg](https://arxiv.org/pdf/1302.3642); Kahneman and Tversky | Method |
| Flips budgeted at 60 min, done in 30–45 once practised | `docs/research/r2-ops-ethnography.md` | Forum anecdotes |

The construction study supports a per-room crew cap: past a point, more people in one room slow each other down.

### 3. Proposed model

**Which figure a gap uses**
1. The staff-set rule is the planning figure.
2. The estimate sits beside it ("Rule 2 h · estimate 1 h 35 with 5 on shift") and replaces it only where no rule exists.
3. With neither, the gap says "not checked", as today.

**The estimate** is a pure function, like the conflict engine:
- **Work, in crew-minutes:** breakdown minutes for the outgoing layout's items plus set-up minutes for the incoming layout's. An item in both layouts (the smaller count) costs only a "move" rate. Staff enter minutes in their own terms: "one round with 10 chairs, clothed, one person: __ min".
- **Elapsed** = fixed allowances + work ÷ min(crew, room cap) × room factor k, never less than the room's floor.
  - Fixed allowances are per room and not divided by crew: cleaning, the AV check, the catering handover.
  - The cap is suggested from floor area and confirmed by staff (the Grand Hall's 21 × 10.5 m suggests about 8).
  - The floor is the longest one-team job, or the route's limit (lift trips × cycle time).
- **Crew:** people rostered with a set-up skill who overlap the window, less anyone needed for a changeover elsewhere at the same time. The source is labelled: rota, default or override.
- **No double counting:** minutes already booked in adjacent set-up and breakdown phases are subtracted (this needs a `setup` template key).
- **The explanation** shows a line per item group, the crew and its source, the factor and how many changeovers back it, a range, and the word "Estimate".

**Learning from real changeovers**
- Capture: "Start changeover" and "Room ready", two taps on the Day Board, queued offline with the device time and checked against the server's receipt time. The crew is confirmed with a stepper prefilled from the rota, with an optional "interrupted" flag. The estimate's inputs are frozen at the start.
- Room factor k: the median of (actual − fixed) ÷ (work ÷ crew) over the last ten or so clean changeovers, pulled toward 1 while there are few (n/(n+3)); the range comes from the quartiles. Interrupted changeovers, those without a confirmed crew and those entered afterwards are excluded; ratios outside ⅓–3× go to a manager with a recorded reason.
- Staff stay in charge: rules and item minutes never change by themselves. The platform suggests ("the last 7 took 85–100 min with 6 on shift; update the rule?"). Per-item fitting waits for about 20 changeovers per room and must beat k on changeovers it has not seen.
- Against gaming: no timing of individuals, no leaderboards or countdowns, and checklist ticks never count as timing.

**Diary warnings**
- Keep `insufficient_turnaround` (the gap is shorter than the rule).
- Add `turnaround_exceeds_crew`: "1 h 30 gap; with 4 on shift the estimate is 1 h 50; fits with 6", or "does not fit at any crew size".
- Add `crew_not_rostered` (not checked) while no shifts exist.
- A warning opens the rule and the estimate beside the room's lane, editable in place.

### 4. Data and endpoints this implies

- `turnaround_rules`: a composite key to the venue's space, a partial unique index, optional from and to layout style, `updated_by`, `confirmed_at`, `fixture_source`, and a history table.
- `turnaround_rates` (catalogue item or category; set-up, breakdown or move; crew-minutes; source), `room_turnaround_profiles` (fixed allowances, cap, floor, route) and `turnaround_runs` (room, bookings, layout hashes, frozen inputs, estimator version, device and server times, crew, interrupted, exclusion reason).
- `/venues/:venueId/turnaround-rules` following `routes/pricing-rules.ts`, including its room-belongs-to-venue check; `/turnaround-rates`, `/turnaround-profile`, `GET /turnarounds/estimate`, `/turnaround-runs`.
