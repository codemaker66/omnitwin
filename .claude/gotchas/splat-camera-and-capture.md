**Read this when:** tuning a captured-room camera, selecting a spawn, or capturing stills.

# Camera behavior must match capture evidence

An interior scan may lack exterior surfaces and unseen geometry. The earlier
dollhouse experiment exposed noisy backs of captured splats. That observation
does not prohibit a future exterior view built from adequate geometry and appearance.
Inspect coverage before choosing a camera or promising a view; validate deliberate
crops, reconstruction and visibility treatment against the target.

For first-person room navigation, rotation should turn the view without translating
the viewer. Use the existing `InteriorCamera` contract and calibrated bounds.
Orbit controls move around a target and can cross a boundary; choose controls by
the interaction mode rather than assuming an orbit is an interior look control.

Use time-based damping, for example `1 - Math.exp(-dt / tau)`, when a filter must
settle consistently across frame rates. Under demand rendering, input must
invalidate to start drawing and active motion must sustain it until settling.
Test the pose after release; accumulated motion can hide a snap-back.

Scan trajectories are useful evidence for candidate spawn positions and free space,
but only after frame/units, room membership and calibration are established. Do not
assume every operator pose is a safe visitor position or that a mesh minimum is the
floor. T-578 corrected measured floor datums; use the current runtime/bundle contract
and verify the result against rendered/source evidence.

For screenshots, wait on meaningful loaded content and failures, not simply the
absence of a loading indicator. Previous heavy demand-loop scenes stalled a
particular screenshot path. Check the actual tool first; if a controlled redraw or
readback is needed, use the existing harness and document it. Do not enable
`preserveDrawingBuffer` across production solely to work around a test tool.
Readbacks and screenshots must not contaminate the timing run used for performance
claims. An SPA's 200 response can be HTML; inspect content type and payload for tiles.
