# The Dressing — storyboard, beat one: the first table

**Date:** 2026-07-10 · **Act:** `#the-dressing` (act 2 of 4 on /living-hall) · **Rule:** storyboard before code (panel gate).

## The idea in one line

As you scroll into the Dressing, an invisible drafting pen lays one round dinner
table in the real room — cloth, then settings, then chairs — in hairline gold
ink, at constant pen speed, close enough to read the place settings.

## Art direction (hard rules, from the plan)

- **Ink, not hologram.** 1px hairlines (the WebGL line-width floor IS the
  plotter aesthetic), desaturated heritage gold `#C9A86A`, opacity ≤ 0.95.
- **No bloom, no flares, no particles.** The single point of light is the pen
  nib itself — a 1.5cm gold point at the stroke head while drawing.
- **Constant pen speed**: draw progress is length-weighted across all strokes,
  so the pen never rushes or crawls; scroll is the only clock.
- **The room is untouched**: ink renders over the capture; gold means
  "placed by the plan" (the page legend already says so).

## Placement (world space, Y-up, capture height = y 0)

- Floor ≈ y −1.60 (scanner head height above floor). Tabletop y −0.85
  (0.75 m table), cloth hem y −1.55.
- Table centre `[-2.0, ·, 7.5]` — mid-room, on the gaze line of dolly
  station 3 (pose 1856 looks from `[1.5, ·, 6.9]` toward `[-5.5, ·, 8.1]`),
  so the camera watches the table being laid as it glides past. Radius 0.9 m,
  eight covers.

## Beats (fractions of the act's scroll range)

| Range | Beat | Strokes |
|---|---|---|
| 0.00–0.10 | **Approach** — dolly glides, nothing drawn; narration panel rises | — |
| 0.10–0.30 | **The cloth** — the table turns into being: rim circle, hem circle, ten drape lines | 12 strokes |
| 0.30–0.55 | **The settings** — eight plates draw clockwise, one at a time; a glass beside each | 16 strokes |
| 0.55–0.65 | **The centre** — candle stem + flame dot, low floral ring | 3 strokes |
| 0.65–0.95 | **The company** — eight chairs draw around the table, alternating sides, one at a time | 8 × 6 strokes |
| 0.95–1.00 | **Settle** — pen nib fades out; ink rests at opacity 0.92 | — |

Sequencing keeps ≤1 element actively drawing at any moment (panel rule ≤12
animating — we use one pen). Scrolling backwards un-draws — the pen erases in
reverse; the visitor owns the clock in both directions.

## Motion & accessibility

- Ink progress = raw section progress (scroll-mapped, user-initiated) — the
  same under reduced motion by construction; there is no autonomous animation
  and no spring on the ink. The dolly keeps its own existing PRM behaviour.
- The document narration for this act already tells the story in prose; the
  canvas stays `aria-hidden`.

## Beat two — the choice, and the floor (2026-07-10)

**The visitor owns the goal**: three quiet choices head the act — *wedding ·
dinner · conference*. The choice re-programs the pen and updates a live
figures line in the document (so the toggle is real content on Tier C too).

**The pen gains confidence**: the first table is drawn lovingly, in full
(beat one, wedding). The fill that follows is drawn in shorthand — rim, four
drapes, a plate ring, seat squares — the draftsman's quicker hand. This is
the narrative AND the stroke budget.

| Type | Fill | Seats | Ceiling (venue truth) |
|---|---|---|---|
| Wedding | first table full + 6 shorthand rounds of 8 | 56 | dinner · 60 |
| Dinner | two long banquets along the room, 15 a side | 60 | dinner · 60 |
| Conference | eight theatre rows of ten, facing the windows | 80 | theatre · 80 |

**The tick**: "«n» seated · the room takes up to «ceiling»" counts up as
elements complete under the pen — n derives from element completion lengths,
ceiling only from `trades-hall-venue-truth` (tests pin both; nothing is
typed by hand). Window: choice zone 0.00–0.10 of the act; the pen runs
0.10–0.95 as before; fill begins after the opener (~0.45 for wedding).

## The crane (2026-07-10)

During the fill the camera lifts off the dolly to a high three-quarter
vantage and the choreography becomes legible from above; it hands back
before the act ends, landing the visitor at eye height inside the finished
plan. Weight bell over act progress: grounded ≤ 0.35 (the intimate opener is
eye-level by design), rise 0.35 → 0.7, hold through 0.9, return by 1.0 —
scroll is the only clock, identical under reduced motion.

**Empirical gate (probed 2026-07-10):** splats collapse (a) at any height
above ~+0.85 over capture height — the ceiling shell — and (b) at ANY height
over ground the scanner never walked. The crane therefore rises strictly
vertically above the walked arrival station, locked at +0.75 (≈2.35 m over
the floor), bracketed by clean proofs at +0.60 and +0.85; +1.25 and two
off-path corners rendered as garbage and are recorded in the probe shots.
Tests pin the pose to the walked station and the clean band.

Still deferred: placement thud (sound), depth-prepass occlusion,
Grand Hall variant, per-table linen colour choices.
