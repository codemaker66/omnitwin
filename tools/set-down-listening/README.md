# The set-down listening page (T-700)

The set-down sound was T-677 until 13 November 2026.

A single page on which the planner's set-down sounds can be heard before they
are wired into the planner. It is built from the engine itself
(`packages/web/src/lib/set-down/*`), bundled, so every sound it plays is the
one the planner will render. It is Blake's ear test (laptop speakers, earbuds,
phone), and the one place render times are measured on his phone against the
spec's budgets (section 9: 2 ms a set-down, 150 ms a tail).

## Build and check

```sh
pnpm --filter @omnitwin/web exec playwright install chromium   # once: the browser the check drives
node tools/set-down-listening/build.mjs                          # writes tools/set-down-listening/out/index.html
node tools/set-down-listening/page.check.mjs                     # Playwright check of that file, screenshots beside it
node tools/set-down-listening/build.mjs --out <folder>           # or build into <folder>/index.html
node tools/set-down-listening/page.check.mjs --out <folder>      # and check that folder's page
```

`out/` is ignored by Git. `build.mjs` bundles `page.ts` with Vite's own
esbuild (resolved through `createRequire`) into one IIFE and inlines it into
`page.html`. The output is page content only, as the Artifact host expects:
the host adds the document, the charset and the viewport.

Type-check and lint the page with:

```sh
node packages/web/node_modules/typescript/bin/tsc -p tools/set-down-listening/tsconfig.json
node_modules/.bin/eslint tools/set-down-listening/page.ts
```

CI runs both, in its Typecheck and Lint jobs. They are the only checks CI makes
on the page: the folder has no package of its own, so `pnpm -r` skips it, and
the browser check stays a local step. On a machine short of memory, run the
check, the type-check and the lint one at a time, when the machine has a few
gigabytes free and no other heavy job or browser run is going; the check starts
Chromium and renders every room's tail.

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
gain. The tail is made at the context's own rate as soon as the context
exists, and at once when the room changes; the dressing slider is gathered
for 250 ms and its tail made in idle slices of at most 4 ms. A new tail is
cross-faded in over 100 ms, and the old one let go after 150 ms (R62). Each
set-down starts so that its audible onset (`onsetSeconds`) lands one frame
after the press, less the output latency, never in the past, and never
before the limiter has run 0.25 s (R63). A press that had to wait for a tail
or for the limiter says so, in ms.

## Choices the page makes that the planner's tasks will own

- **The send.** Ruling R11 makes the send `REVERB_SEND × reverberantGain`,
  not scaled by the direct gain, and the registry does not define
  `REVERB_SEND` yet (Task 13). The page derives it from diffuse-field theory
  (EST): a source on the floor (Q = 2) has a reverberant energy of 32π / R
  times its direct energy at the 2 m reference, so with the tail at unit
  energy the send is √(32π / R_ref), R_ref being the empty Grand Hall's room
  constant at 1 kHz, air included (the engine's `roomConstant`). Each set-down is rendered at full direct gain and turned
  down by its dry gain (`min(1, 2 / distance)`, Task 12's `directPath`): the
  render is linear in its direct gain, so the dry sound is the same, and the
  send is the room's alone.
- **The cascade.** `planCascade` does not exist yet (Task 12). The page
  follows its plan: one piece of each table family first, then chairs spread
  across the layout, eight in all, 85–110 ms apart (seeded), each 1 dB
  softer. Each landing is heard from the chosen distance on the line to a
  listener at the room's end (Task 12's ear rule, at least 2 m), on the
  room's floor. The ear stays 1.6 m up for every voice; only its place on the
  floor follows that line (R61).
- **The limiter chain, copied by hand.** `sound-registry.ts` does not export
  its planner graph's output chain, so the page rebuilds it: the master, a
  compressor with `PLANNER_LIMITER`'s settings (knee 0), then the trim that
  takes back its makeup gain (`limiterMakeupDb`). Part 3 exports the
  chain-building code, and the page imports it.
- **The limiter's warm-up, copied by hand.** The page's 0.25 s wait before the
  first play mirrors the registry's unexported
  `PLANNER_LIMITER_WARMUP_SECONDS`. Part 3 exports it, and the page imports it.
- **The galleries' walls.** The planner draws the galleries from the
  space's outline in the database; the web package has no drawn geometry for
  them, so their reflections come off the surveyed 11.5 × 4.1 × 2.8 m room.

## What to listen for in the ear test

- **Each piece as itself on each surface:** a Chiavari's click on oak boards, the
  hollow boom of a deck, the muffled set-down on the galleries' carpet, the clank
  of folding legs.
- **Each room's echo as it fills:** drag the dressing from empty to the dinner and
  set a piece down again; the echo should shorten and drop in level.
- **The echo's level is an estimate.** The send carries the whole render, its
  early reflections included, while diffuse-field theory's 4W/R already counts
  reflected energy, so the echo leans about 1-2 dB toward "too much" (EST, ruling
  R64). If it sounds a little too wet, this is the likely cause; Task 13 decides
  whether the send takes the direct part only.
- **The Robert Adam Room's low-mid ring at 250-500 Hz.** Its fitted factors (1.26
  at 250 Hz, 1.16 at 500 Hz) are the non-uniform-absorption effect of a room whose
  absorption sits on its floor and ceiling (ruling R59). Listen for whether that
  ring sounds like the room or like a fault.
- **The first press** waits until the limiter has run 0.25 s (ruling R63), so
  every play is heard at its true level; the readout shows that wait, and any
  wait for a tail still being made.

## Device figures

With the `db` capability, each device keeps one document at
`timings/<device>`, the device being a short hash of the user agent and the
screen's size: the user agent, the screen size, the context's sample rate,
the date, and per piece the last 20 render times in milliseconds, with the
last 20 tail render times. It is read once when the store arrives and written
once per 1.5 s pause, one write at a time. If the store has not answered in
10 s the page says so, and keeps waiting. An `unavailable` write is
transient: the next change tries again after a pause that doubles from 2 s to
at most 60 s. A full store, or any other refusal, stops saving for the visit.
Without the capability the page works the same and says that it does not
save.

## Measured on Blake's phone

Not yet measured.
