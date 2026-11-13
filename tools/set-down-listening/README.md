# The set-down listening page (T-677)

A single page on which the planner's set-down sounds can be heard before they
are wired into the planner. It is built from the engine itself
(`packages/web/src/lib/set-down/*`), bundled, so every sound it plays is the
one the planner will render. It is Blake's ear test (laptop speakers, earbuds,
phone), and the one place render times are measured on his phone against the
spec's budgets (section 9: 2 ms a set-down, 150 ms a tail).

## Build and check

```sh
node tools/set-down-listening/build.mjs                 # writes D:/claude/furniture-sound-20261027/listening/index.html
node tools/set-down-listening/page.check.mjs            # Playwright check of that file, screenshots beside it
```

`build.mjs` bundles `page.ts` with Vite's own esbuild (resolved through
`createRequire`) into one IIFE and inlines it into `page.html`. The output is
page content only, as the Artifact host expects: the host adds the document,
the charset and the viewport. On this PC, run the check through the browser
hold after `wait-memory.sh`, and type-check and lint through the heavy hold:

```sh
node packages/web/node_modules/typescript/bin/tsc -p tools/set-down-listening/tsconfig.json
node_modules/.bin/eslint tools/set-down-listening/page.ts
```

The page is published as a private claude.ai artifact with
`capabilities: { db: {} }`.

## What it plays

- **Room:** the six surveyed rooms, their reverberation from `roomState`.
- **What it lands on:** the room's floor, a staging deck, the dance floor or a
  6 ft trestle's top, resolved by `surfaceKindForSupport`, as the planner will
  resolve the piece under each foot.
- **Piece:** the 44 bodies in `SET_DOWN_BODIES`, grouped by family, named as
  the catalogue names them.
- **Dressing:** that share of `referenceDinner(room)`, in its order.
- **Distance:** 2–6 m from the ear (1.6 m up) to the landing.
- **Set it down** renders `kind: "drop"`; **Move it** renders `kind: "settle"`
  (the renderer takes a quarter of the speed); **Lay out a dinner** plays a
  cascade of eight from the reference dinner.

The graph mirrors the registry's planner graph: each voice into a dry gain
and a send to a `ConvolverNode` holding `renderRoomTail`'s tail for the room
as dressed, a master at `PLANNER_SOUND_DEFAULT_LEVEL`, the registry's
`PLANNER_LIMITER` compressor (knee 0) and the trim that takes back its makeup
gain. The tail is rendered in idle slices of at most 4 ms when the room or
its dressing changes (the slider is gathered for 250 ms) and cross-faded in
over 120 ms. Each set-down starts so that its audible onset (`onsetSeconds`)
lands one frame after the press, less the output latency, never in the past.

## Choices the page makes that the planner's tasks will own

- **The send.** Ruling R11 makes the send `REVERB_SEND × reverberantGain`,
  not scaled by the direct gain, and the registry does not define
  `REVERB_SEND` yet (Task 13). The page derives it from diffuse-field theory
  (EST): a source on the floor (Q = 2) has a reverberant energy of 32π / R
  times its direct energy at the 2 m reference, so with the tail at unit
  energy the send is √(32π / R_ref), R_ref being the empty Grand Hall's room
  constant at 1 kHz. Each set-down is rendered at full direct gain and turned
  down by its dry gain (`min(1, 2 / distance)`, Task 12's `directPath`): the
  render is linear in its direct gain, so the dry sound is the same, and the
  send is the room's alone.
- **The cascade.** `planCascade` does not exist yet (Task 12). The page
  follows its plan: one piece of each table family first, then chairs spread
  across the layout, eight in all, 85–110 ms apart (seeded), each 1 dB
  softer. Each landing is heard from the chosen distance on the line to a
  listener at the room's end (Task 12's ear rule, at least 2 m), on the
  room's floor.
- **The galleries' walls.** The planner draws the galleries from the
  space's outline in the database; the web package has no drawn geometry for
  them, so their reflections come off the surveyed 11.5 × 4.1 × 2.8 m room.

## Device figures

With the `db` capability, each device keeps one document at
`timings/<device>`, the device being a short hash of the user agent and the
screen's size: the user agent, the screen size, the context's sample rate,
the date, and per piece the last 20 render times in milliseconds, with the
last 20 tail render times. It is read once when the store arrives and written
once per 1.5 s pause, one write at a time. Without the capability the page
works the same and says that it does not save.

## Measured on Blake's phone

Not yet measured.
