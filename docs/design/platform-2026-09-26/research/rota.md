## A staff rota for a venue: products, UK rules, fairness and fit (T-637)

Research for Blake's third-round answer that turnaround times "will also depend on how much staff is available so we will need staff rota also to be part of our platform". Read-only; 26 September 2026. **Information only, not legal advice.**

### How to read the evidence

The network proxy blocked every page fetch (gov.uk, legislation.gov.uk, Acas, Capterra, G2, Trustpilot, vendor sites). Every web fact below comes from **search-result extracts** of the cited pages, not full reads; check them in a browser before relying on them. Repo facts come from the integration tree at `2be601ca`.

### 1. Rota products

| Product | Praised / criticised | What matters for a venue |
| --- | --- | --- |
| Planday (Xero) | Quick rotas and swaps / slow pages; reports need Excel; awkward Xero link | Punch clock with location; Xero receives hours but not wage rates ([help](https://help.planday.com/en/articles/30296-xero-integration-overview)) |
| Deputy | Simple / missed notifications leave shifts unconfirmed; slow; hard to set up ([connecteam](https://connecteam.com/reviews/deputy/)) | Open shifts go only to staff with the right training tags ([help](https://help.deputy.com/hc/en-au/articles/4688725542415-Open-shifts-with-approval)) |
| RotaCloud | Simple; good support / leave doesn't reopen the shift; no offline mode | Recurring availability; Sage CSV and Staffology exports ([unrubble](https://unrubble.com/blog/rotacloud)) |
| Rotaready | Live wage cost / rigid ([Parim](https://www.parim.co/articles/best-hospitality-rostering-software)) | Forecasts from till and reservation data; Xero, Sage, BrightPay ([Xero store](https://apps.xero.com/uk/app/rotaready)) |
| 7shifts | Labour cost against sales / late notifications; separate clock-in app ([connecteam](https://connecteam.com/reviews/7shifts/)) | Front- and back-of-house roles |
| When I Work | Easy; shows who has read the schedule / late or missed notifications ([Capterra](https://www.capterra.com/p/121248/When-I-Work/reviews/)) | Swaps, open shifts |
| Harri | Clean schedule / weak app; payroll discrepancies ([connecteam](https://connecteam.com/reviews/harri/)) | Rules per location |
| Fourth / HotSchedules | Fast copying / dated, desktop-first, extra fees ([connecteam](https://connecteam.com/reviews/hotschedules/)) | Demand forecasts in 30-minute slots that count bookings and events ([Fourth](https://uk.fourth.com/solution/workforce-management/scheduling)) |

Event-staffing tools: Workstaff sends an urgent shift to every qualified, available person at once; Shiftboard checks staff in by phone ([Roosted](https://www.roostedhr.com/blog/best-event-staff-scheduling-software)).

Inference: the commonest complaints are notifications that do not arrive and slow screens; payroll links are partial; these products forecast from till sales, while a venue's demand is the booked function itself, so Venviewer can staff straight from the Diary.

### 2. UK employment rules (GB law applies in Scotland)

| Rule | Source | What the rota should do |
| --- | --- | --- |
| Average of 48 hours a week or less over 17 weeks, unless the worker opts out in writing (cancellable on 7 days' notice) | Working Time Regulations 1998 [reg 4](https://www.legislation.gov.uk/uksi/1998/1833/regulation/4), reg 5 | Keep a rolling average; store the opt-out |
| 11 hours' rest in a row each day (12 for under-18s) | [reg 10](https://www.legislation.gov.uk/uksi/1998/1833/regulation/10/made) | Warn when a late finish meets an early start |
| 24 hours' rest in every 7 days (or 2×24 / 1×48 in 14); under-18s 48 in 7 | [reg 11](https://www.legislation.gov.uk/uksi/1998/1833/regulation/11) | Warn |
| A 20-minute break when working over 6 hours (under-18s: 30 minutes over 4.5 hours) | [reg 12](https://www.legislation.gov.uk/uksi/1998/1833/regulation/12) | Build the break into the shift |
| Night workers average 8 hours or less per 24 (night is 23:00–06:00 by default) | [reg 6](https://www.legislation.gov.uk/uksi/1998/1833/regulation/6) | Flag staff who regularly do late lock-ups |
| Under-18s: at most 8 hours a day and 40 a week; no work 22:00–06:00. Catering, hotels and bars may use them late under conditions, but never between midnight and 04:00 | [reg 5A](https://www.legislation.gov.uk/uksi/1998/1833/regulation/5A), [reg 6A](https://www.legislation.gov.uk/uksi/1998/1833/regulation/6A), reg 27A | **Block** midnight–04:00; warn otherwise |
| Children below school-leaving age: no work after 19:00 | [1937 Act s28](https://www.legislation.gov.uk/ukpga/Edw8and1Geo6/1/37/section/28) | **Block** |
| Where an exception to the rest rules applies, equivalent compensatory rest is owed | [reg 21](https://www.legislation.gov.uk/uksi/1998/1833/regulation/21/made), [reg 24](https://www.legislation.gov.uk/uksi/1998/1833/regulation/24/made) | Override only with a recorded reason and the rest given |
| Keep records showing compliance for 2 years | [reg 9](https://www.legislation.gov.uk/uksi/1998/1833/regulation/9) | Keep approved timesheets |
| Irregular-hours and part-year workers accrue leave at 12.07% of hours worked (leave years from 1 April 2024); rolled-up holiday pay allowed if shown separately | [SI 2023/1426](https://www.legislation.gov.uk/uksi/2023/1426/made) | Accrue each pay period; export holiday pay as its own line |
| Keep holiday records for 6 years (from 6 April 2026) | [business.gov.uk](https://www.business.gov.uk/campaign/employment-changes/) | Keep them |
| A zero-hours contract cannot stop someone working elsewhere | [ERA 1996 s27A](https://www.legislation.gov.uk/ukpga/1996/18/section/27A) | Never block for other work |
| Anyone selling alcohol needs 2 hours' training, recorded on the premises | [Licensing (Scotland) Act sch 3](https://www.legislation.gov.uk/asp/2005/16/schedule/3/crossheading/training-of-staff), [SSI 2007/397](https://www.legislation.gov.uk/ssi/2007/397/made) | Require the bar skill for bar shifts |
| Check the right to work before the first shift (fines up to £60,000) | [gov.uk](https://www.gov.uk/penalties-for-employing-illegal-workers) | Hold the first shift until the check is recorded |

**Employment Rights Act 2025** ([legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2025/36)), Royal Assent 18 December 2025. In force on 26 September 2026: sick pay from the first day, paternity leave from the first day of employment, 6-year holiday records. **Not yet in force:** guaranteed hours, reasonable notice of shifts, and pay for shifts cancelled or cut at short notice. Official timelines put these in 2027; the notice period (one to four weeks were consulted on) and the payment are not set; only employer changes will count, not swaps ([consultation](https://www.gov.uk/government/consultations/make-work-pay-ending-one-sided-flexibility-reforms-of-zero-hours-and-similar-contracts), [Acas](https://www.acas.org.uk/employment-rights-act-2025)). The Workers (Predictable Terms and Conditions) Act 2023 was repealed on 6 January 2026.

**Minimum wage from 1 April 2026** ([gov.uk](https://www.gov.uk/government/news/national-living-wage-increases-to-1271-per-hour)): £12.71 at 21 and over; £10.85 at 18–20; £8.00 at 16–17 and for apprentices.

### 3. Fair, low-stress rotas

- Unstable schedules predict distress and poor sleep more strongly than low wages do ([Schneider & Harknett 2019](https://journals.sagepub.com/doi/abs/10.1177/0003122418823184)).
- 32% of UK workers get less than a week's notice of shifts; 50% of the low-paid (Living Wage Foundation).
- Stable schedules paid off in Gap's trial: median sales +7%, productivity +5% ([WorkLife Law](https://worklifelaw.org/projects/stable-scheduling-study/report/)).
- Living Hours asks for 4 weeks' notice, with full pay for shifts cancelled inside it ([Living Wage Foundation](https://www.livingwage.org.uk/living-hours)).
- Letting staff choose their shifts improved work–life balance ([Albertsen et al.](https://link.springer.com/article/10.1007/s00420-013-0857-x)).
- Batching notifications three times a day improved attention and mood; none at all raised anxiety ([Fitz 2019](https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596)).
- Automatic allocation should be explained, consulted on, and share its benefits ([Acas](https://www.acas.org.uk/research-and-commentary/my-boss-the-algorithm-an-ethical-look-at-algorithms-in-the-workplace)).
- Our own research (`docs/design/hallkeeper-2026-09-07/research/veteran-work.md`) already requires that cover counts only once someone accepts it, rest is protected, nobody is ranked by ticks, and paid hours are never inferred from phone activity.

Implications: publish four weeks ahead; say why each offer went to that person; one daily digest, with immediate alerts only when urgent; share late finishes evenly and visibly.

### 4. How the rota connects to the rest

- **The Diary sets demand.** Each Confirmed function's date, room, set-for headcount and service style suggest the roles needed in each phase: set-up, service, room flip, breakdown, lock-up. Provisional and option holds show only as likely demand; no shifts are offered for them.
- **Turnaround estimates** use the set-up crew on shift (see [turnarounds.md](turnarounds.md)).
- **Hallkeeper tasks** go to people on the rota; handing over cover needs the other person to accept.
- **Staffing ratios** are industry guidance, not law, and vary widely, so they are editable defaults: silver service one per 8–10 guests, plated 10–12 ([Cube Staff](https://www.cubestaff.co.uk/post/how-many-waiting-staff-do-i-need-for-my-event), [PartyCalcs](https://partycalcs.uk/food-and-catering/catering-staff-calculator/)); a US plated norm of 20, or 16 with poured wine ([Cvent](https://www.cvent.com/en/blog/events/banquet-service-ratios)); a bar per 40–50 guests simple, 30 full ([Event Staff Scotland](https://eventstaffscotland.co.uk/blog/how-many-waiting-staff-bar-staff-will-i-need-for-my-celebratory-hospitality-event/)).
- **The caterers' staff.** Trades Hall's caterers are Regis Banqueting and Top Class Catering; Top Class also supplies bar service and event management ([Top Class](https://topclasscatering.com/trades-hall/)). Waiting and bar staff may be the caterers' own, so the rota needs "supplied by caterer" lines.

### 5. What the repo already has

- Roles include caterer, sales and manager; each user has one role and one venue. `users.phone` exists; there are no contract, pay, birth-date or skill fields.
- `events` holds the three headcounts; `bookings` holds room, option rank and owner; `event_phases.staffConflictsStatus` defaults to `not_checked` and nothing computes it.
- Handoff packs hold `ops_tasks`, `room_flip_plans` and `pick_list_items`; `task_assignments` holds a user or a text label; mission phases and tasks record actual times.
- In-app notices (`event_plan_notifications`, `NotificationCenter.tsx`), email through Resend with `email_sends` preventing duplicates, a scheduling pattern in `services/hold-reminders.ts`, and hashed, expiring supplier share tokens that could carry shift offers without a login. There is no SMS or push provider.

### Recommended minimum lovable rota

Build first:
1. Staff records that need no login: employment type; skills (set-up, bar-trained with its date, duty manager); the date an under-18 turns 18; the right-to-work check and its expiry; the 48-hour opt-out.
2. Staffing needs from each Confirmed function, from editable ratios, adjusted in place.
3. Availability and offers: casual staff mark when they are free; offers go to qualified people in fair rotation, accepted with one tap through a signed link.
4. Working-time warnings in plain words beside each shift; the only hard blocks are the two legal ones; any override records its reason.
5. Publishing the week: one digest, "changed since you last looked" per person, and the notice given recorded for every cancellation, ready for 2027.
6. Timesheets: sign-in on a tablet at the Hall (no GPS or fingerprints, per the ICO); a manager approves; a CSV for Sage, BrightPay or Xero with holiday pay as its own line.
7. Crew on the Day Board and function sheet, and turnaround estimates from the crew actually on shift.

Later: swaps; live payroll connections; labour cost against revenue; guaranteed hours (after the 2027 rules); estimates that learn; SMS; tips; pools shared across venues.
