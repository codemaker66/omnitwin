# The living timetable — the attention system (goal 19, D3)

**Status:** the exact tokens for goal 19's D3 table, written at S0 (8 October 2026,
T-651) and consumed by S3 (the board), S4 (the ring) and S8 (the wall). Every colour
below was measured with the WCAG relative-luminance formula against the ground it sits
on; dots, rings and edges clear 3:1, text clears 4.5:1. Blake's spoken palette is kept
literally for the ramp: green, then orange, then red. Severity rides on cadence and a
copper ring, never on colour alone; every state pairs an icon, a verb and a colour.

Surfaces: the office board and the phone use the selected ivory register
(`styles/hallkeeper-register.css`, paper arrangement). The wall display uses the
register's dark arrangement, pending human input 1 ("wall dark, as decided" or "all
ivory"); until Blake answers, S3 builds the ivory board and the wall mode is a
redefinition of the same tokens, not a second stylesheet.

## Tokens

The tokens are custom properties scoped to the board root (`.dayboard`), named `--lt-*`.
The paper values are the defaults; `[data-register="wall"]` on the same root redefines
them. A component never names a hex; it names a token.

### Paper register — office and phone (ground `--hk-ivory` #f4f1e9, raised #fffdf8)

| Token | Value | On ivory | On raised | Carries |
|---|---|---|---|---|
| `--lt-hairline` | `var(--hk-forest)` #385542 | 7.31 | 8.11 | the scheduled slot's forest hairline |
| `--lt-green` | #3f8a57 | 3.73 | 4.14 | organisers due: dot and edge |
| `--lt-amber` | #a07614 | 3.65 | 4.05 | guests due: dot and edge |
| `--lt-amber-deep` | #b5581a | 4.25 | 4.72 | imminent: dot and edge |
| `--lt-live` | `var(--vv-oxblood)` #8E3A2C | 6.66 | 7.40 | live: the LIVE label, the breathing dot and the slab's breath overlay |
| `--lt-sage` | `var(--hk-sage)` #a9c3a4 | decorative | decorative | clear-down hatching; its label uses `--lt-sage-ink` |
| `--lt-sage-ink` | `var(--vv-sage-ink)` #4A6650 | 5.40 | 5.97 | clear-down label text |
| `--lt-faded` | `var(--house-slate-dot)` #8e9992 | edge only | edge only | done: the slate edge; the words stay full ink |
| `--lt-red` | `var(--hk-alert)` #c2503e | 4.12 | 4.57 | changeover at risk: the slab's edge, the legend's dot and a short gap's rule; the words say why |
| `--lt-ring` | `var(--hk-copper)` #986246 | 4.46 | 4.95 | attention, urgent and owned: the copper ring and its count (the count sits on a raised fill, 4.95) |
| `--lt-urgent-label` | `var(--vv-oxblood)` #8E3A2C | 6.66 | 7.40 | the URGENT word inside the ring |
| `--lt-stale-band` | `var(--house-slate-wash)` #e3e3db | surface | surface | the offline or stale band across the top |
| `--lt-stale-text` | `var(--house-slate-text)` #545e59 | 5.96 | 6.62 | the band's words |
| `--lt-ink` | `var(--hk-ink)` #2e382e | 10.81 | 12.00 | all other text; never tinted by state |

### Wall register — `[data-register="wall"]` (ground `--hk-forest-ink` #1e2721, raised #263028)

| Token | Value | On ground | On raised | Note |
|---|---|---|---|---|
| `--lt-hairline` | `var(--hk-forest-soft)` #5b7a63 | 3.22 | 2.87 | hairline only; the slot's words carry the state |
| `--lt-green` | #3f8a57 | 3.65 | 3.25 | one green on both grounds |
| `--lt-amber` | #a07614 | 3.73 | 3.32 | one amber on both grounds |
| `--lt-amber-deep` | #b5581a | 3.20 | 2.85 | on a raised slab the wall uses #c9761d (3.97) |
| `--lt-live` | #d4786a | 4.90 | 4.36 | oxblood lifted for the dark ground; text-safe |
| `--lt-sage` | `var(--hk-sage)` #a9c3a4 | 8.07 | 7.18 | hatching and label |
| `--lt-faded` | #8e9992 | 5.21 | 4.64 | |
| `--lt-red` | `var(--hk-alert-light)` #e0917a | 6.2 | 5.5 | the alert lifted for the dark ground; #c2503e was 2.94 on a raised slab |
| `--lt-ring` | `var(--house-accent-copper)` #C98A5B | 5.32 | 4.73 | the brass of Blake's reference, as the register's copper |
| `--lt-urgent-label` | #e08a7c | 5.92 | 5.27 | lifted once more than `--lt-live`: the URGENT word is a label and needs 4.5:1 on the raised ring, which #d4786a (4.36) missed |
| `--lt-stale-band` | #8e9992 | surface | surface | words in `--hk-forest-ink` (5.21 on the band) |
| `--lt-ink` | `var(--hk-paper)` #f3efe4 | 13.37 | 11.90 | |

### Cadence and amplitude

| Token | Value | For |
|---|---|---|
| `--lt-breath-organisers` | 4s | organisers due |
| `--lt-breath-guests` | 3s | guests due |
| `--lt-breath-imminent` | 2s | imminent |
| `--lt-breath-live` | 4s | live: the room's heartbeat and the liveness signal |
| `--lt-breath-attention` | 4s | an unowned request's ring, after its arrival |
| `--lt-pulse-urgent` | 1.5s | urgent, until acknowledged |
| `--lt-arrival` | 200ms | one arrival stamp when a request lands |
| `--lt-live-amplitude` | 0.12 | the live overlay's peak opacity: at most 12 % luminance change |
| `--lt-dot-amplitude` | 0.35 | the breathing dot's opacity floor is 1 − this |
| `--lt-epoch-phase-ms` | set once per mount | the phase of corrected now inside the 60-second epoch |

## The states

Trigger times are venue-local on the corrected clock (D9). "Setup" is the booking's
earliest phase in that room, falling back to the booking's start; "doors" is the booking's
start. Every state has an icon (lucide), a verb the slot reads aloud, a colour token and a
motion; reduced motion keeps the words and loses only the motion.

| State | Trigger | Icon · verb | Colour | Motion | Reduced motion | Sound |
|---|---|---|---|---|---|---|
| Scheduled | more than 60 min before setup | `Clock` · "Scheduled 13:00" | ink on the lane, `--lt-hairline` | none | — | — |
| Organisers due | setup within 60 min | `Wrench` · "Organisers · 48 min" | `--lt-green` | dot breath, `--lt-breath-organisers` | "Organisers · 48 min", steady dot | — |
| Guests due | doors within 30 min | `Users` · "Guests · 22 min" | `--lt-amber` | dot breath, `--lt-breath-guests` | "Guests · 22 min" | — |
| Imminent | doors within 10 min | `DoorOpen` · "Doors · 6 min" | `--lt-amber-deep` | dot breath, `--lt-breath-imminent` | "Doors · 6 min" | — |
| Live | start ≤ now < end | `Radio` · "LIVE · 1 h 12 elapsed" | `--lt-live` | slab overlay breath at `--lt-live-amplitude`, `--lt-breath-live` | "LIVE · 1 h 12 elapsed" | — |
| Clear-down | end to the next setup, within the turnaround | `RotateCcw` · "Clear-down · 40 min" | `--lt-sage` hatch, `--lt-sage-ink` label | none | — | — |
| Done | marked done by a hallkeeper (S5) | `Check` · "Done 17:40" | `--lt-faded` edge | none | — | — |
| Attention | a request landed and nobody owns it | `Bell` · "1 request · nobody has this" | `--lt-ring` with a count | one `--lt-arrival` stamp, then ring breath `--lt-breath-attention` until acknowledged | steady ring and count | one chime, opt-in |
| Urgent | an urgent request unacknowledged; an overrun; a changeover at risk | `AlertTriangle` · "URGENT · waiting 3 min" | `--lt-ring`, label `--lt-urgent-label` | ring pulse `--lt-pulse-urgent` until acknowledged | steady ring and "URGENT" | one chime, opt-in |
| Owned | accepted | `UserCheck` · "Elaine has this" | `--lt-ring` steady | none | — | — |
| Offline or stale | socket down more than 60 s; or data older than 2 min while the socket is down or the last refresh failed (a quiet afternoon with the socket up is live however old its read) | `WifiOff` · "Offline since 14:02 · reconnecting" | `--lt-stale-band`, `--lt-stale-text` | none; every breath on the board stops | — | — |

Priority when several apply to one slot: offline or stale over everything (the band, and
no breath anywhere); then urgent, attention and owned rings sit on top of the timed state,
which keeps its own colour and words; a slot is never two colours at once, so the ring is
the second channel and the timed state the first.

### What the room was seen doing (S5)

Observations are facts beside the schedule (D1): set, doors open, live, flipping, done,
cleaned, each with the hallkeeper's own time from the corrected clock at the tap. The slot
reads the latest fact by that time, whatever order the facts arrived, as a marginal line
("Doors open 18:52", "Room set 17:40"); the timed state keeps its colour and words. Three
facts change the slab:

| Seen | Trigger | Icon · verb | Colour | Resolves |
|---|---|---|---|---|
| Done or cleaned | the latest fact is done or cleaned | `Check` · "Done 22:48" / "Cleaned 23:10" | `--lt-faded` edge, nothing left to tick | — |
| Overrun | the latest fact is doors open, live or flipping; five minutes past the booking's end; no done signal | `AlertTriangle` · "Overrun · 12 min past 23:00", detail "Live 19:05 · not marked done" | `--lt-red` edge, label `--lt-urgent-label` | a done or cleaned tap |
| Changeover at risk | the room before this slot was seen and its latest fact is not cleaned, that booking has ended, and the turnaround it needs no longer fits before this setup | `AlertTriangle` · "Changeover at risk · Guests · 15 min", detail "Chamber dinner not yet cleared · 15 min until setup, 30 min needed" | `--lt-red` edge | a cleaned tap on the room before, or this slot's doors |

A room nobody has recorded raises nothing: without a done signal there is no overrun, and
without a doors-open or live signal there is nothing to overrun. The overrun threshold and
the instant a changeover becomes at risk are boundaries like any other, so the clock ticks
to them exactly. Nothing observed ever writes a time on the booking.

## Laws

1. **Phase lock.** Every cadence (4, 3, 2 and 1.5 s) divides 60 s, so one 60-second
   epoch aligns them all. A CSS animation starts when it is applied, so a phase
   sampled once at mount would align only the breaths that began then; instead each
   breathing element samples its own `--lt-epoch-phase-ms` as
   `(correctedNow − epochStart) mod 60000` the moment its breath begins (a slab's
   motion changing at a boundary, a ring mounting for a new request, a freeze
   lifting) and declares `animation-delay: calc(-1ms * var(--lt-epoch-phase-ms))`
   (`useBreathPhase` in `lib/use-board-clock.ts`). Two screens, and two breaths that
   began an hour apart, land on the venue's minute grid. When the clock correction
   itself moves by half a second the phase is sampled again and the breath shifts
   once onto the corrected grid.
2. **CSS only.** Animation is on `transform` and `opacity` only, declared in
   `day-board.css`. No React render per frame, no JavaScript timer drives a pulse.
3. **Boundary-exact ticks.** The next state transition is scheduled to the millisecond
   with one `setTimeout` from the derivation (the earliest boundary among all slots),
   never polled every 30 s. A tick costs ≤ 2 ms on the main thread with a dense day.
4. **A pulse exists only for a state a person can act on,** and it quiets on
   acknowledgement while the unresolved work stays as a steady slab with its ring.
5. **Nothing strobes.** The fastest cadence is 1.5 s (0.67 Hz), far under the
   three-flashes-per-second threshold. Amplitudes are small: the live overlay never
   exceeds `--lt-live-amplitude` (12 %) and a dot never drops under 65 % opacity.
6. **The live breath is the one ambient motion in the product,** because it doubles as
   the liveness signal: every breath stops the instant the socket drops after it has
   been up (`data-frozen` on the board root), and the stale band follows a minute
   later, so a still LIVE slab is itself the warning that the display is not live. A
   board that has never connected since mount breathes for that first minute and then
   shows the band.
7. **Colour never carries meaning alone.** Every state is an icon, a verb and a colour;
   the legend is worded exactly as the slots are.
8. **Text is never tinted by state.** `--lt-ink` everywhere; tone lives in the dot, the
   edge, the ring and the hatch.
9. **The single token** that would change Blake's red-for-live is `--lt-live`; the
   earlier plan's "red only for exceptions" is withdrawn.
10. **The ring's words never breathe.** The copper ring is a static line round full-ink
    words; a second line outside it, the halo, is what breathes or pulses, so the count
    and the words hold their contrast at every point of the cycle (law 8 applied to the
    ring). The wall shows no slot detail at all (D11): a slab there is a group, not a
    button.

## Sound

Opt-in, once per device, from a visible control on the board ("Chime on arrivals"). One
chime per arrival and one per escalation to this person; never on a tick, never repeated.
The sample is the building's own room tone (HUMAN.md 6) once Blake records it, and a
plain bell until then. Audio off loses nothing: the ring and the words are the signal.

## Accessibility

Targets are 44 px. The next-action line and the stale band are `role="status"`; an
arrival is announced through an `aria-live="polite"` region and an urgent request through
`aria-live="assertive"`, each once. Under `prefers-reduced-motion: reduce` every
animation is `none` and the words are already carrying the state. Contrast is as the
tables above measure; S3's house-tokens test holds every `--lt-*` dot and ring to ≥ 3:1
on its ground and every label to ≥ 4.5:1.
