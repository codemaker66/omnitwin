# Splat alignment — shared status board

**Lane owners:** Claude Code (ingest pipeline + app surface) and Codex (alignment
quality). This file is the seam between them. Either may edit it; read it before
touching anything below.

**Last updated:** 2026-08-27 by Claude Code.

---

## What is already shipped

The eight XGRIDS captures of Trades Hall are ingested, staged and rendering in
the app. Nothing here is blocked on alignment.

| Piece | Where |
| --- | --- |
| Ingest tool | `tools/xgrids-lcc2/` (`measure`, `stage`) |
| Generated manifest | `packages/web/src/data/generated/trades-hall-splat-bundles.ts` |
| Web consumption | `packages/web/src/data/room-splat-bundles.ts` |
| In-app surface | `/captures/:roomSlug` and `/venues/:venueSlug/captures/:roomSlug` |
| Dev tile serving | `packages/web/src/lib/splat-staging-plugin.ts` (SPLAT_STAGING_ROOT) |
| Published tiles | R2 `omnitwin-uploads`, key prefix `splats/trades-hall/<room>/` |
| Publish script | `packages/api/src/scripts/publish-splat-tiles.ts` |

Tile bytes are **not** in the repository (~1 GB). They are staged locally and
published to R2; the repo holds only the manifest.

---

## The open problem: six of eight rooms are misaligned

A handheld SLAM capture's bounding box is the volume the operator *walked*, not
the room — 2–6× too large here, because the walk includes corridors, stairwells
and the approach. The tool measures the room from each capture's own room mesh
rather than assuming the raw bounds, and reports how much of the capture landed
inside the derived frame (`retention`). Low retention means the capture is
mostly not-this-room, so the frame cannot be trusted.

| Room | Retention | State | Why |
| --- | --- | --- | --- |
| deacon-conveners-room | 99% | **confident** | clean single-room scan |
| saloon | 97% | review | disagrees with published 12×7 m |
| reception-room | 96% | **confident** | agrees with published dims |
| north-gallery | 87% | review | borderline retention |
| grand-hall | 73% | review | spans more than the hall |
| lady-convenors-room | 70% | review | spans adjacent space |
| south-gallery | 68% | review | spans adjacent space |
| robert-adam-room | 49% | review | **whole-floor scan**; room is a small part |

Two distinct failure modes, and they need different fixes:

1. **Low retention** (robert-adam, south, lady, grand-hall). The capture covers
   far more than the room. No per-axis measurement can isolate one room from a
   whole-floor scan without being told where to look. → set a crop, below.
2. **High retention but disagrees with published dims** (saloon, at 97%). The
   measurement is confident and the published figure disagrees. Cropping will
   NOT fix this. Either the capture is mapped to the wrong room, or the venue's
   published number describes usable floor area rather than built volume. This
   needs a human decision, not a tuning knob.

---

## How to improve a room (the intended path)

**Codex owns this.** Set `roomCropM` on the room's entry in
`tools/xgrids-lcc2/src/capture-sources.ts` — an explicit crop box in XGRIDS
source metres, applied before measuring. Record *how it was derived* in that
entry's `note`. It is reviewable project data, deliberately not a magic constant
buried in the measurement code.

Then re-measure and regenerate:

```bash
pnpm --filter @omnitwin/xgrids-lcc2 lcc2 -- measure \
  --scans "C:\GAUSSIAN SPLAT SCANS\Gaussian splat outputs from remote pc" \
  --grand-hall "C:\GRAND_HALL_BIG_MODEL_VARIATIONS" --room <slug>

pnpm --filter @omnitwin/xgrids-lcc2 lcc2 -- stage \
  --scans "C:\GAUSSIAN SPLAT SCANS\Gaussian splat outputs from remote pc" \
  --grand-hall "C:\GRAND_HALL_BIG_MODEL_VARIATIONS" \
  --out "D:\claude\splats" \
  --manifest "packages/web/src/data/generated/trades-hall-splat-bundles.ts"
```

`stage` skips tiles already staged at the same size, so regenerating the
manifest costs seconds, not another gigabyte.

Improving the *algorithm* rather than a single room is also fair game —
`tools/xgrids-lcc2/src/obj-bounds.ts` is where measurement lives. Its tests pin
the two failure modes it was built against (a corridor spur and a stairwell); if
you change the rules, change those fixtures honestly rather than loosening the
assertions.

---

## Boundaries — what NOT to touch

So the two lanes do not collide:

- **Never hand-edit** `packages/web/src/data/generated/trades-hall-splat-bundles.ts`.
  It is generated. Regenerate it. A hand edit will be silently overwritten.
- **Do not weaken the claim rules.** These captures are unregistered and
  unaligned; nothing may present them as reviewed, certified, production-ready,
  photoreal or survey-grade. `STAGED_CAPTURE_STATUS` in
  `packages/web/src/lib/runtime-package-resolution.ts` is the sanctioned copy.
- **Do not make `/captures` public.** It is admin-gated in production precisely
  because six rooms sit wrong. Promotion to a client-facing surface is Blake's
  call, room by room, via `publicShowcaseEnabled` in
  `packages/types/src/asset-version.ts` — currently `false` for all eight.
- **Do not change `scale` away from 1.** Captures and the scene are both metric.
  A scale factor means the capture is not metric or a room is being squeezed
  onto a stage it does not fit; either should stop the pipeline, not be absorbed.
  The Reception Room's old hand-tuned `0.63` is exactly the mistake being fixed.
- Web wiring (`room-splat-bundles.ts`, `RoomCapturesPage.tsx`, the router, the
  vite plugin) is Claude Code's lane. Coordinate here before changing it.

---

## The interface between the lanes

The generated manifest **is** the contract. Codex improves alignment, regenerates
it, and the app picks the improvement up with no web code change at all. That is
the whole reason the transform is data rather than code.

A room graduates from `review` to `confident` automatically once retention
reaches 90% with no published-dimension disagreement — `alignmentConfidence` in
the manifest, surfaced as the badge on `/captures`. Nothing needs to be told.

---

---

## New: the room is clipped to its measured box

`packages/web/src/components/rooms/RoomClipBox.tsx` attaches a Spark
`SplatEdit` with an inverted `BOX` SDF at `opacity: 0`, so every splat outside
the room's measured box has its alpha multiplied to zero. Confirmed working
against the real captures: the cut is clean and hard-edged.

**This raises the stakes on alignment considerably.** The box comes straight
from `extentM` in the generated manifest, which is your output. So:

- Where the box is right, the camera can leave the room and frame it as an
  object — a dollhouse view — because the corridor and stair are simply gone.
  `/room/<slug>?view=dollhouse` renders exactly that.
- Where the box is wrong, clipping cannot help. North Gallery clips to a wedge
  because the wedge is what its frame describes. Garbage box in, garbage room
  out.

So fixing a room's `roomCropM` no longer just improves a number. It unlocks the
dollhouse view for that room, promotes its badge on the front door from
"Alignment in progress" to a real measurement, and lets the page print its
dimensions — all automatically, with no web change. The manifest remains the
only contract.

### Open: the dollhouse does not yet read as a room

Clipping is proven — beyond the box is black, and the cut is hard-edged. What is
NOT working is the view from outside. Two things stand in the way:

1. **The lid cut has no visible effect.** `keepHeightFraction` trims the box's
   top, and reception at 0.72 renders identically to 1.0. The most likely cause
   is that `SplatEditSdf` BOX does not take `scale` as half-extents the way this
   code assumes; it may want full extents, or the `radius` field. Verify against
   Spark's editor example before trusting any vertical crop.
2. **From outside you see the backs of surfaces.** A scanner only ever saw the
   inside of a room, so the outward face of every wall and ceiling is noise.
   Even with a correct lid cut, a dollhouse needs the near walls dropped too,
   not just the ceiling.

None of this affects what ships: `?view=dollhouse` is opt-in, and both the front
door and the default walkthrough put the camera inside the room, which works.


### Two capture traps, if you render stills

Both cost hours to find:

1. **`frameloop="demand"` starves the compositor.** Once a room finishes
   loading nothing invalidates, so `page.screenshot()` never returns — it waits
   forever for a frame that is not coming. Nudge the canvas (a small drag makes
   OrbitControls invalidate) or read the canvas back directly. The walk page
   accepts `?bare=1`, which drops the chrome and turns on
   `preserveDrawingBuffer` so `canvas.toDataURL()` works. That is the only
   capture path that has proved reliable.
2. **"Wait until the loading indicator is gone" is true before it appears.**
   It returns at t=0 and captures an empty room. Wait on
   `window.__roomWalk.complete`, which can only be true once.

## Log

Append here rather than rewriting, newest last.

- **2026-08-27, Claude Code** — Ingest built and shipped. 8 rooms, 127 tiles,
  1,039 MB staged and published. All tiles verified byte-for-byte against their
  sha256 receipts. Reception Room confirmed rendering as a photoreal interior.
  Six rooms left at `review`; handing alignment quality to Codex.
- **2026-08-28, Claude Code** — Front door rebuilt as a room selector
  (`/`, poster-first, one room streams at a time). Public walkthrough at
  `/room/<slug>`. Splat clipping added, which makes a dollhouse view possible
  for any room whose box is right. Two of eight qualify today.
