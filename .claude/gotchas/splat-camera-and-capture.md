**Read this when:** building or tuning a camera over a Gaussian splat, capturing
stills of a splat scene offline, or deciding where to put a viewer inside a
captured room.

# A splat capture only ever saw the inside

Every trap below comes from one fact: a room scan records the surfaces the
scanner could see, and it was inside the room the whole time. There is no data
on the far side of a wall or above a ceiling — only the backs of the splats that
form them.

## Never show a captured room from outside

An exterior view of an interior capture is the back of a ceiling and the back of
a wall. It renders as a closed box of noise, and no amount of clipping rescues
it, because clipping reveals what is behind a surface and there is nothing
behind these.

This was learned the expensive way: a "dollhouse" view was built, clipped so the
walls survived and the lid came off, and it still showed a smear — because the
lid was never the problem. That option has been removed rather than left for
someone to rediscover.

Corollary for offline stills: shoot from **inside**. A poster rendered from
outside is not a worse picture of the room, it is a picture of nothing.

## OrbitControls cannot keep a viewer in a room

`OrbitControls` rotates the camera *around a target point*. Looking left
therefore swings the camera bodily through the wall and out of the room. This is
structural, not a matter of tuning `maxDistance` — any orbit radius large enough
to see the room is large enough to leave it.

Inside a room, rotation must not write position.
`components/rooms/InteriorCamera.tsx` turns the head and never the body, which
reduces containment to holding translation inside a box.

## Damping must be frame-rate independent, or it reads as lag

    // Wrong: a different filter at 30 fps than at 144.
    x += (target - x) * 0.1;

    // Right: settles in the same wall-clock time on any machine.
    x += (target - x) * (1 - Math.exp(-dt / tau));

A per-frame lerp feels sluggish on a slow machine and twitchy on a fast one.
Users report that as "laggy" even when the frame rate is fine, and profiling the
renderer will find nothing wrong.

Snap the state exactly onto its target on the frame it settles. Stopping at the
epsilon freezes a sub-pixel error into the last drawn frame, and under
`frameloop="demand"` nothing will ever redraw it.

## Under frameloop="demand", invalidation has two halves

`useFrame` does not run while the loop is idle, so **it can never restart
itself**. Every input handler that changes a target must call `invalidate()` to
wake the loop; `useFrame` then calls `invalidate()` to sustain it while anything
is still resolving.

Build only the second half and the camera appears frozen until some unrelated
thing happens to redraw the scene.

## Screenshotting a loaded splat canvas never returns

`page.screenshot()` waits for the compositor to produce a frame. A settled
demand-loop scene never produces another one, so the call hangs until timeout —
at 30 s, 60 s and 90 s alike. Raising the timeout is not the fix.

Two things that do work, and are needed together:

1. Nudge the scene so it draws — a small drag makes the controls invalidate.
2. Read the canvas back in-page with `toDataURL`, having created the context
   with `preserveDrawingBuffer: true`. Without that flag the buffer is cleared
   after present and you get a blank image.

Injecting a stylesheet after a heavy splat load also forces a re-composite that
re-triggers the stall; hide chrome with a page-level flag the app understands
(`?bare=1`) rather than `addStyleTag`.

## "Wait until the loading indicator is gone" is a false signal

It is true *before* React mounts the indicator as well as after loading ends, so
it returns at t=0 and captures an empty scene. Wait for the indicator to appear
and then to go, or better, wait on a published count (`window.__roomWalk`).

The same shape of error bit a deploy check: an SPA catch-all returns HTTP 200
for every path, so `200` proved nothing about whether tiles were serving. Assert
on `content-type`, not status.

## The capture ships the scanner's own walk — use it

`lcc2-result/info/poses.json` holds every pose the operator occupied, in the
same coordinate frame as the splats. It is the most useful file in the bundle.

A person carrying a scanner stays inside the room, at eye height, in the free
space, so the walk gives a spawn point that cannot be outside, a boundary past
which there is no data, and an eye height. Measured against published room sizes
it beats measuring the mesh outright — the Grand Hall goes from 85% out to 5%.

Use both: the floor from the mesh, which can see it, and everything horizontal
from the walk, which cannot. Eye height is the difference between them.

The exception is a capture where the operator walked a whole floor rather than
one room. No per-axis measurement of either instrument can isolate a room from
that; it needs an explicit crop.
