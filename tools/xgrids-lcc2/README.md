# @omnitwin/xgrids-lcc2

Turns an XGRIDS LCC2 capture into something the Venviewer runtime can show: an
ordered tile list, a room-local transform derived from the capture's own room
mesh, and a staged copy of the tile bytes.

It is deliberately conservative. It never writes to, renames inside, or deletes
from a capture root, and it reports low confidence rather than inventing an
alignment it cannot justify.

## Why this exists

A handheld SLAM capture's bounding box is the volume the operator *walked*, not
the room. Across the eight Trades Hall captures the raw box runs 2–6× the
published room size, because the walk includes corridors, stairwells and the
approach. Point a viewer at the raw bounds and every room lands in the wrong
place — which is how the Reception Room ended up with a hand-tuned `scale: 0.63`
and a standing "not a signed room-local alignment" caveat.

So the room is **measured** rather than assumed, from the `mesh-files/*.obj`
that ships in every bundle.

## Commands

Measure every capture without writing anything:

```bash
pnpm --filter @omnitwin/xgrids-lcc2 lcc2 -- measure \
  --scans "C:\GAUSSIAN SPLAT SCANS\Gaussian splat outputs from remote pc" \
  --grand-hall "C:\GRAND_HALL_BIG_MODEL_VARIATIONS"
```

Stage tile bytes outside the repo and regenerate the committed manifest:

```bash
pnpm --filter @omnitwin/xgrids-lcc2 lcc2 -- stage \
  --scans "C:\GAUSSIAN SPLAT SCANS\Gaussian splat outputs from remote pc" \
  --grand-hall "C:\GRAND_HALL_BIG_MODEL_VARIATIONS" \
  --out "D:\claude\splats" \
  --manifest "packages/web/src/data/generated/trades-hall-splat-bundles.ts"
```

Add `--room <slug>` to either command to work on one room.

`stage` skips a tile that is already staged at the same size, so re-running to
refresh the manifest costs seconds rather than recopying a gigabyte.

## How a room is measured

Per axis, build an occupancy histogram of the mesh vertices, smooth it, and keep
the dominant run. Two axes are treated differently because they fail
differently:

- **Horizontal (X, Y)** — a corridor leading away from the room is *connected*
  to it and moderately dense, so only run analysis separates the two. Smoothing
  matters here: real rooms have doorways and occlusion shadows that punch
  genuine holes, and too strict a gap tolerance splits one gallery into five
  runs (South Gallery measured 3.16 m across a 10.12 m axis before smoothing).
- **Vertical (Z)** — a stairwell climbing out of the room is a long tail of
  *moderate* density, and how far the room's own bins stand above it depends
  entirely on how flat and how densely sampled its floor happens to be. Tuning
  that ratio to fit one capture breaks another. Instead the vertical axis uses a
  physical prior: take the band of at most 16 m holding the most geometry, then
  trim to its occupied part. A stairwell can never win that contest.

The transform is then a rotation (Z-up → Y-up) and a translation that puts the
room's floor on y = 0 and its centre over the origin. **Never a scale.** A scale
factor would mean the capture is not metric or that a room is being squeezed
onto a stage it does not fit; both should stop the pipeline rather than be
absorbed into a fudged number.

## Confidence, and what to do about `review`

Retention — the share of the capture sitting inside the derived frame — is the
signal that matters. A single-room scan retains nearly all of itself; a
whole-floor scan cannot, because most of what was walked is not this room.

A room is `confident` at ≥ 90% retention with no published-dimension
disagreement, and `review` otherwise. As of the first pass:

| Room | Retention | Confidence |
| --- | --- | --- |
| deacon-conveners-room | 99% | confident |
| reception-room | 96% | confident |
| saloon | 97% | review — disagrees with published 12×7 m |
| north-gallery | 87% | review |
| grand-hall | 73% | review |
| lady-convenors-room | 70% | review |
| south-gallery | 68% | review |
| robert-adam-room | 49% | review — a whole-floor scan |

For a `review` room caused by low retention, set `roomCropM` on its entry in
`src/capture-sources.ts` to say where the room is, and record the derivation in
its `note`. That is reviewable project data, not a magic constant buried in the
measurement code.

A published-dimension disagreement at *high* retention (the Saloon) is a
different problem: cropping will not fix it. Either the capture is mapped to the
wrong room, or the venue's published figure describes usable floor area rather
than the built volume. It needs a human, not a tuning knob.

## What it does not do

It does not register anything. Runtime packages are immutable revisions behind
an administrator gate, and nothing here writes to that registry. Staged tiles
are exactly that — staged — and every surface that shows them is expected to say
so.
